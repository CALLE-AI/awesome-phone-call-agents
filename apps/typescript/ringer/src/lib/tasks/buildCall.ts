import type { CreateCallBody, JsonObject } from '@/lib/calle/types'
import type { CreatePayload } from '@/lib/calle/client'
import type { DemoPlanRecipient } from '@/lib/calle/demoEngine'
import { calleRegionCode, currencyForRecipients, currencyName, isEnglishLocale, languageLabel, nonEnglishLanguages } from '@/lib/regions'
import type { TaskTemplate, TaskValues } from './types'

export interface RecipientInput {
  /** Display name of the business/person being called. */
  businessName: string
  /** E.164 phone number. */
  phone: string
  region: string
  locale: string
}

export interface IdentityInput {
  callerName: string
  callbackNumber?: string
}

export interface BuildCallArgs {
  template: TaskTemplate
  values: TaskValues
  identity: IdentityInput
  recipients: RecipientInput[]
  batch: boolean
}

const NAME_KEYS = ['company', 'business'] as const

/** Inject a per-recipient business name into a copy of the shared values. */
function withName(values: TaskValues, name: string): TaskValues {
  if (!name) return values
  const next: TaskValues = { ...values }
  for (const k of NAME_KEYS) next[k] = name
  return next
}

function aggregateSchema(templateId: string): JsonObject {
  if (templateId === 'get-quote') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['businesses_called'],
      properties: {
        businesses_called: { type: 'integer', description: 'How many businesses were called.' },
        reached: { type: 'integer', description: 'How many were reached by a live person.' },
        quotes_received: { type: 'integer', description: 'How many gave a usable price quote.' },
        cheapest_business: { type: 'string', description: 'Cheapest among businesses that actually quoted.' },
        cheapest_price: { type: 'number' },
        potential_savings: { type: 'number', description: 'Cheapest vs priciest, among quotes received only.' },
        note: { type: 'string', description: 'Caveat naming any not reached or that declined; they are not counted.' },
      },
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['recipients_called'],
    properties: {
      recipients_called: { type: 'integer' },
      reached: { type: 'integer', description: 'How many were reached by a live person.' },
      completed_count: { type: 'integer', description: 'How many produced a usable answer.' },
      note: { type: 'string', description: 'Caveat naming any not reached; they are not counted.' },
    },
  }
}

/** Instruct CALL-E to keep the batch aggregate honest about its denominator. */
function batchHonestyDirective(templateId: string): string {
  const unit = templateId === 'get-quote' ? 'a price quote' : 'a usable answer'
  return `\nAGGREGATION HONESTY: In the call-level result, count only businesses that actually gave ${unit}. Report how many were called, how many were reached by a live person, and how many answered. Businesses that did not answer (voicemail, no answer, declined) must NOT be counted as agreement or included in comparisons — add a short note naming how many were not reached.`
}

let counter = 0
function workflowId(): string {
  counter += 1
  return `ringer_${Date.now().toString(36)}_${counter}`
}

/**
 * Assemble the CALL-E create-call body plus the demo plan.
 *
 * Single call: the task embeds the specific business name and a single
 * `result_schema`. Batch (Quote Shootout): the task is generic ("each
 * business"), `recipient_result_schema` extracts a per-business result, and
 * a call-level `result_schema` captures the aggregate comparison.
 */
export function buildCall(args: BuildCallArgs): CreatePayload {
  const { template, values, identity, recipients, batch } = args
  // Currency follows each number's country code first (so a +234 number quotes
  // in ₦ even with the default region), then the region selector; a mixed batch
  // has no single currency (null → per-business handling).
  const uniformCurrency = currencyForRecipients(recipients.map((r) => ({ phone: r.phone, region: r.region })))
  const currency = uniformCurrency ?? 'USD'
  const ctx = { callerName: identity.callerName, callbackNumber: identity.callbackNumber, currency }

  const body: CreateCallBody = {
    task: '',
    recipients: recipients.map((r) => ({
      phones: [r.phone],
      // Substitute a CALL-E-supported region for unlisted dial-only regions
      // (Nigeria → US); the phone number is still the real destination.
      region: calleRegionCode(r.region),
      locale: r.locale,
    })),
    metadata: {
      app: 'ringer',
      template: template.id,
      workflow_run_id: workflowId(),
    },
  }

  let demoPlan: DemoPlanRecipient[]

  if (batch && recipients.length > 1) {
    // Generic task; per-recipient + aggregate schemas.
    body.task = template.buildTask(values, ctx)
    body.recipient_result_schema = template.buildResultSchema(values)
    body.result_schema = aggregateSchema(template.id)
    demoPlan = recipients.map((r) => ({
      label: r.businessName || r.phone,
      phone: r.phone,
      region: r.region,
      locale: r.locale,
      businessName: r.businessName,
      values: withName(values, r.businessName),
    }))
  } else {
    const only = recipients[0]
    const namedValues = withName(values, only?.businessName ?? '')
    body.task = template.buildTask(namedValues, ctx)
    body.result_schema = template.buildResultSchema(namedValues)
    demoPlan = [
      {
        label: only?.businessName || only?.phone || 'Call',
        phone: only?.phone ?? '',
        region: only?.region,
        locale: only?.locale,
        businessName: only?.businessName,
        values: namedValues,
      },
    ]
  }

  // Denominator honesty for batch runs: never let the aggregate overstate.
  if (batch && recipients.length > 1) {
    body.task += batchHonestyDirective(template.id)
  }

  // Localization: tell the agent which language to speak. CALL-E localizes
  // per-recipient via `locale`, but stating it in the task makes the whole
  // conversation reliably run in the recipient's language.
  body.task += languageDirective(recipients, batch && recipients.length > 1)

  // Currency: keep amounts in the recipient's local currency (no conversion),
  // so a German gym quotes € and an Indian one ₹ — never silently in dollars.
  body.task += currencyDirective(recipients, batch && recipients.length > 1)

  return { body, templateId: template.id, demoPlan, currency }
}

/** Append-to-task instruction pinning the currency amounts are quoted in. */
function currencyDirective(recipients: RecipientInput[], isBatch: boolean): string {
  const currency = currencyForRecipients(recipients.map((r) => ({ phone: r.phone, region: r.region })))
  if (isBatch && !currency) {
    // Mixed-currency batch: each business quotes in its own local currency.
    return '\nIMPORTANT: Quote and report each business’s amounts in that business’s own local currency — do not convert between currencies.'
  }
  // US calls need no note (dollars is the implicit default); others are explicit.
  if (!currency || currency === 'USD') return ''
  return `\nIMPORTANT: Ask for and report all monetary amounts in ${currencyName(currency)} (${currency}) — the recipient’s local currency. Do not convert to another currency.`
}

/** Append-to-task instruction naming the language(s) the call should use. */
function languageDirective(recipients: RecipientInput[], isBatch: boolean): string {
  if (isBatch) {
    const langs = nonEnglishLanguages(recipients.map((r) => r.locale))
    if (!langs.length) return ''
    return `\nIMPORTANT: Conduct each call entirely in the recipient's local language (${langs.join(', ')}) — greeting, phone-menu navigation, and the whole conversation. Capture and report all structured results in English.`
  }
  const locale = recipients[0]?.locale
  if (isEnglishLocale(locale)) return ''
  const lang = languageLabel(locale)
  return `\nIMPORTANT: Conduct the entire call in ${lang} — greet, navigate phone menus, negotiate, and respond entirely in ${lang}. Capture and report the structured result in English.`
}

/**
 * Harden a payload for a follow-up attempt: escalate past the first line of
 * defense and handle voicemail gracefully. Demo Mode picks the escalated
 * success script via the `__escalated` flag.
 */
export function escalatePayload(payload: CreatePayload): CreatePayload {
  return {
    ...payload,
    body: {
      ...payload.body,
      task:
        payload.body.task +
        '\nFOLLOW-UP ATTEMPT: A previous call did not reach a resolution. If you reach a person, politely ask for a supervisor, retention specialist, or someone with authority to resolve this. If you reach voicemail again, leave a short professional message with the callback number and the reason for the call.',
      metadata: { ...(payload.body.metadata ?? {}), escalated: true },
    },
    demoPlan: payload.demoPlan.map((p) => ({
      ...p,
      values: { ...p.values, __escalated: 'yes' },
    })),
  }
}

#!/usr/bin/env node
/**
 * build-task.mjs — turn a consumer phone task + a few fields into a precise
 * CALL-E `task` instruction and a STRICT JSON `result_schema`.
 *
 * This is the reusable core of the Ringer app, ported to a dependency-free
 * Node script so any agent can compose well-scoped consumer calls without
 * re-deriving the prompt engineering or the structured-output contract.
 *
 * Usage:
 *   node build-task.mjs --playbook negotiate-bill --values '{"company":"Xfinity","currentAmount":"95","goal":"lower","leverage":"AT&T offers $55","walkAway":"yes","approvalMode":"ask"}'
 *   node build-task.mjs --list                       # list playbooks + required fields
 *   node build-task.mjs --playbook get-quote --values '{...}' --batch   # per-recipient + aggregate schemas
 *   node build-task.mjs --playbook cancel-subscription --values '{...}' --caller "Alex Rivera" --callback "+14155550100"
 *
 * Output (stdout): JSON { playbook, task, result_schema, recipient_result_schema?, missing_required }
 * Exit code is 0 even when required fields are missing; inspect `missing_required`.
 * This script NEVER places a call — it only composes the request. Placement is
 * a separate, consent-gated step (see place-call.mjs).
 */

/* ----------------------------- value helpers ----------------------------- */

const s = (v, k) => (typeof v?.[k] === 'string' ? v[k].trim() : '')
const list = (v, k) => {
  const val = v?.[k]
  if (Array.isArray(val)) return val.filter(Boolean)
  if (typeof val === 'string' && val.trim()) return [val.trim()]
  return []
}
const compose = (...lines) => lines.filter((l) => Boolean(l && String(l).trim())).join('\n')
const money = (raw) => {
  if (!raw) return ''
  const n = Number(String(raw).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n)) return String(raw)
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
const identity = (ctx) => {
  // Fixed AI disclosure, stated at the start of every call (never caller-editable).
  const bits = [
    'At the very start of the call, clearly disclose that you are an AI voice assistant calling on the caller’s behalf; do not imply you are the account holder speaking in person.',
  ]
  if (ctx.callerName) bits.push(`You are calling on behalf of ${ctx.callerName}.`)
  if (ctx.callbackNumber) bits.push(`If asked for a callback number, provide ${ctx.callbackNumber}.`)
  return bits.join(' ')
}
const strict = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
})

const OUTCOME_ENUM = ['success', 'partial', 'failed', 'callback_required']

/* ------------------------------- playbooks ------------------------------- */

const PLAYBOOKS = {
  'negotiate-bill': {
    label: 'Negotiate a bill',
    required: ['company', 'goal'],
    buildTask: (v, ctx) => {
      const goal = s(v, 'goal')
      const goalLine =
        goal === 'waive_fee' ? 'get a specific fee waived or refunded'
        : goal === 'match' ? 'get my rate matched to a competitor offer'
        : goal === 'promo' ? 'restore or extend a promotional price'
        : 'reduce my monthly bill as much as possible'
      return compose(
        `Call ${s(v, 'company') || 'the company'} and negotiate on my behalf to ${goalLine}.`,
        identity(ctx),
        s(v, 'currentAmount') && `My current bill is about ${money(s(v, 'currentAmount'))} per month.`,
        s(v, 'accountRef') && `Account reference: ${s(v, 'accountRef')}.`,
        s(v, 'leverage') && `Context and leverage to use: ${s(v, 'leverage')}`,
        s(v, 'walkAway') === 'yes'
          ? 'If they refuse to help, politely say I am considering cancelling and ask to be transferred to the retention or loyalty department, then continue negotiating. Do not actually cancel anything.'
          : 'Do not threaten to cancel the service.',
        'Be polite, patient, and persistent. Navigate any phone menus, hold music, and transfers as needed. Never agree to a higher price or add-ons.',
        s(v, 'approvalMode') === 'auto' && s(v, 'autoAcceptBelow')
          ? `DECISION AUTHORITY: You may accept an offer of ${money(s(v, 'autoAcceptBelow'))} per month or lower on my behalf. If the best offer stays above that amount, do NOT commit — negotiate for the best possible offer, capture its exact terms (amount, promo length), and say I will confirm shortly.`
          : 'DECISION AUTHORITY: You may NOT accept or commit to any offer on my behalf. When you receive an offer, push at least once for a better one, then capture the exact best offer (amount, promo length, any conditions) and tell the representative I will confirm shortly. Never say yes to a binding change.',
        'If a discount is applied, confirm the exact new monthly amount, the length of the promotion, and any confirmation number before ending the call.',
        'Do not make up account details, PINs, or personal information. If you are asked for something you were not given, say you do not have it on hand.',
      )
    },
    buildResultSchema: () =>
      strict(
        {
          outcome: { type: 'string', enum: OUTCOME_ENUM, description: 'Overall result of the negotiation.' },
          previous_amount: { type: 'number', description: 'Prior monthly amount in dollars if known.' },
          new_amount: { type: 'number', description: 'New agreed monthly amount in dollars, if any.' },
          monthly_savings: { type: 'number', description: 'Monthly savings in dollars, if any.' },
          promo_length: { type: 'string', description: 'Duration of any promo, e.g. "12 months".' },
          confirmation_number: { type: 'string' },
          agent_name: { type: 'string', description: 'Name of the human representative, if given.' },
          next_steps: { type: 'string', description: 'Any follow-up the user must do.' },
        },
        ['outcome'],
      ),
  },

  'cancel-subscription': {
    label: 'Cancel a subscription',
    required: ['company'],
    buildTask: (v, ctx) =>
      compose(
        `Call ${s(v, 'company') || 'the company'} and cancel the subscription/membership on my behalf, effective as soon as allowed.`,
        identity(ctx),
        s(v, 'accountRef') && `Account reference: ${s(v, 'accountRef')}.`,
        s(v, 'reason') && `Reason for cancelling: ${s(v, 'reason')}`,
        s(v, 'declineOffers') === 'consider'
          ? 'If they make a retention offer, do NOT accept it — note the exact offer so I can decide, and still ask them to proceed with cancellation unless it requires my confirmation.'
          : 'Politely decline any retention offers, discounts, or pauses. I want to fully cancel.',
        'Navigate phone menus, hold, and transfers as needed. Insist on cancellation. Before ending the call, get: a cancellation confirmation number, the exact effective date, and confirmation that no further charges will occur. Ask whether any final or prorated charge applies.',
        'Do not make up personal information, PINs, or card numbers. If asked for something you were not given, say you do not have it available.',
      ),
    buildResultSchema: () =>
      strict(
        {
          outcome: { type: 'string', enum: OUTCOME_ENUM, description: 'success = cancelled/confirmed; partial = started but needs a step; callback_required = must call back or do online.' },
          cancellation_confirmation: { type: 'string' },
          effective_date: { type: 'string', description: 'When the cancellation takes effect.' },
          final_charge: { type: 'string', description: 'Any final or prorated charge described.' },
          retention_offer: { type: 'string', description: 'Any retention offer that was made.' },
          next_steps: { type: 'string' },
        },
        ['outcome'],
      ),
  },

  'book-appointment': {
    label: 'Book an appointment',
    required: ['business', 'purpose'],
    batchable: true,
    buildTask: (v, ctx) => {
      const prefs = list(v, 'preferredTimes')
      return compose(
        `Call ${s(v, 'business') || 'the business'} and book an appointment on my behalf.`,
        identity(ctx),
        s(v, 'purpose') && `What the appointment is for: ${s(v, 'purpose')}`,
        s(v, 'patientName') && `Book it under the name: ${s(v, 'patientName')}.`,
        prefs.length
          ? `My scheduling preferences, in priority order: ${prefs.join('; ')}. Get the closest available slot that fits these.`
          : 'Ask for the earliest reasonable availability and pick a sensible slot.',
        'Navigate any phone menus or hold. Confirm the exact date, time, location/address, and any confirmation number or provider name before ending the call. If none of my preferred times work, book the closest good alternative and clearly report what you booked.',
        'Do not invent personal details, insurance numbers, or card numbers. If asked for something you were not given, say you will follow up with it.',
      )
    },
    buildResultSchema: () =>
      strict(
        {
          outcome: { type: 'string', enum: OUTCOME_ENUM, description: 'success = booked; partial = tentative/waitlist; failed = could not book.' },
          appointment_datetime: { type: 'string', description: 'Booked date and time in plain language.' },
          appointment_iso: { type: 'string', description: 'Exact appointment start as an ISO 8601 datetime when determinable, else null.' },
          location: { type: 'string' },
          provider_name: { type: 'string', description: 'Provider, table, or staff member if relevant.' },
          confirmation_number: { type: 'string' },
          notes: { type: 'string', description: 'Anything to bring or prepare, or why it failed.' },
        },
        ['outcome'],
      ),
  },

  'chase-refund': {
    label: 'Chase a refund',
    required: ['company', 'issue'],
    buildTask: (v, ctx) => {
      const res = s(v, 'resolution')
      const want =
        res === 'replacement' ? 'a replacement or redo of the service'
        : res === 'credit' ? 'an account credit'
        : res === 'either' ? 'a full refund (an account credit is acceptable if a refund is refused)'
        : 'a full refund to my original payment method'
      return compose(
        `Call ${s(v, 'company') || 'the company'} on my behalf to resolve a billing/service issue and obtain ${want}.`,
        identity(ctx),
        s(v, 'orderRef') && `Order/reference: ${s(v, 'orderRef')}.`,
        s(v, 'amount') && `Amount in dispute: ${money(s(v, 'amount'))}.`,
        s(v, 'issue') && `What happened: ${s(v, 'issue')}`,
        'Be firm but courteous. Reference any prior promises. Navigate phone menus, hold, and escalate to a supervisor if the first agent cannot help. Before ending, confirm: whether the refund/credit is approved, the exact amount, the method, the expected date it will post, and a confirmation or case number.',
        'Do not invent card numbers or personal information. If asked for something you were not given, say you will follow up with it.',
      )
    },
    buildResultSchema: () =>
      strict(
        {
          outcome: { type: 'string', enum: OUTCOME_ENUM, description: 'success = refund/credit approved; partial = escalated/opened case; failed = denied.' },
          amount_recovered: { type: 'number', description: 'Approved amount in dollars.' },
          method: { type: 'string', description: 'Refund, replacement, or credit.' },
          expected_date: { type: 'string' },
          case_number: { type: 'string' },
          next_steps: { type: 'string' },
        },
        ['outcome'],
      ),
  },

  'get-quote': {
    label: 'Get a price quote',
    required: ['business', 'service'],
    batchable: true,
    buildTask: (v, ctx) =>
      compose(
        `Call ${s(v, 'business') || 'the business'} and get a clear price quote on my behalf.`,
        identity(ctx),
        s(v, 'service') && `What I need quoted: ${s(v, 'service')}`,
        s(v, 'timeframe') && `Timeframe: ${s(v, 'timeframe')}.`,
        'Ask for a specific total or a low–high price range, what is included, any extra fees, and the earliest availability. If they can only give a range, capture the range. Do not commit to or book anything — I only want the quote.',
        'Be brief and friendly. Navigate any phone menu to reach a person who can quote.',
      ),
    buildResultSchema: () =>
      strict(
        {
          outcome: { type: 'string', enum: OUTCOME_ENUM, description: 'success = got a usable quote; partial = vague/partial; failed = no quote.' },
          price_low: { type: 'number', description: 'Low end of quote in dollars.' },
          price_high: { type: 'number', description: 'High end (or same as low if a single price).' },
          includes: { type: 'string', description: 'What the price includes.' },
          availability: { type: 'string' },
          contact_name: { type: 'string' },
          notes: { type: 'string' },
        },
        ['outcome'],
      ),
  },

  'general-inquiry': {
    label: 'Ask a question',
    required: ['business', 'question'],
    batchable: true,
    buildTask: (v, ctx) =>
      compose(
        `Call ${s(v, 'business') || 'the business'} on my behalf and get clear answers to my questions.`,
        identity(ctx),
        s(v, 'reference') && `Reference: ${s(v, 'reference')}.`,
        s(v, 'question') && `Questions to get answered: ${s(v, 'question')}`,
        'Navigate any phone menu to reach a person or automated system that can answer. Capture the specific answers clearly. If they cannot answer, note who can and how to reach them. Do not commit me to anything.',
      ),
    buildResultSchema: () =>
      strict(
        {
          outcome: { type: 'string', enum: OUTCOME_ENUM, description: 'success = got clear answers; partial = some answered; failed = none.' },
          answer: { type: 'string', description: 'The answer(s) to the question(s).' },
          contact_name: { type: 'string' },
          next_steps: { type: 'string' },
        },
        ['outcome'],
      ),
  },

  custom: {
    label: 'Something else',
    required: ['task'],
    batchable: true,
    buildTask: (v, ctx) =>
      compose(
        s(v, 'task') || 'Make a phone call on my behalf.',
        identity(ctx),
        list(v, 'collect').length
          ? `Make sure to find out and clearly report: ${list(v, 'collect').join('; ')}.`
          : '',
        'Navigate any phone menus, hold, and transfers as needed. Do not invent personal information; if asked for something you were not given, say you do not have it on hand. Do not commit me to anything without it being part of the goal above.',
      ),
    buildResultSchema: (v) => {
      const items = list(v, 'collect')
      const props = {
        outcome: { type: 'string', enum: OUTCOME_ENUM },
        summary: { type: 'string', description: 'Plain-language summary of what happened.' },
      }
      items.forEach((item, i) => {
        props[`answer_${i + 1}`] = { type: 'string', description: `Answer to: ${item}` }
      })
      return strict(props, ['outcome'])
    },
  },
}

/** Call-level aggregate schema for a batch (Quote Shootout) run. */
function aggregateSchema(playbookId) {
  if (playbookId === 'get-quote') {
    return strict(
      {
        businesses_called: { type: 'integer', description: 'How many businesses were called.' },
        reached: { type: 'integer', description: 'How many were reached by a live person.' },
        quotes_received: { type: 'integer', description: 'How many gave a usable price quote.' },
        cheapest_business: { type: 'string', description: 'Cheapest among businesses that actually quoted.' },
        cheapest_price: { type: 'number' },
        potential_savings: { type: 'number', description: 'Cheapest vs priciest, among quotes received only.' },
        note: { type: 'string', description: 'Caveat naming any not reached or that declined; they are not counted.' },
      },
      ['businesses_called'],
    )
  }
  return strict(
    {
      recipients_called: { type: 'integer' },
      reached: { type: 'integer', description: 'How many were reached by a live person.' },
      completed_count: { type: 'integer', description: 'How many produced a usable answer.' },
      note: { type: 'string', description: 'Caveat naming any not reached; they are not counted.' },
    },
    ['recipients_called'],
  )
}

/** Instruct CALL-E to keep the batch aggregate honest about its denominator. */
function batchHonestyDirective(playbookId) {
  const unit = playbookId === 'get-quote' ? 'a price quote' : 'a usable answer'
  return `\nAGGREGATION HONESTY: In the call-level result, count only businesses that actually gave ${unit}. Report how many were called, reached, and answered. Businesses that did not answer (voicemail, no answer, declined) must NOT be counted or compared — add a short note naming how many were not reached.`
}

/* --------------------------------- CLI ---------------------------------- */

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') out.list = true
    else if (a === '--batch') out.batch = true
    else if (a === '--playbook') out.playbook = argv[++i]
    else if (a === '--values') out.values = argv[++i]
    else if (a === '--caller') out.caller = argv[++i]
    else if (a === '--callback') out.callback = argv[++i]
    else if (a === '--language') out.language = argv[++i]
  }
  return out
}

/** Append a directive so the call is conducted in a non-English language. */
function languageDirective(language) {
  const lang = String(language || '').trim()
  if (!lang || /^english$/i.test(lang)) return ''
  return `\nIMPORTANT: Conduct the entire call in ${lang} — greet, navigate phone menus, negotiate, and respond entirely in ${lang}. Capture and report the structured result in English.`
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.list || !args.playbook) {
    const listing = Object.entries(PLAYBOOKS).map(([id, p]) => ({
      id,
      label: p.label,
      required: p.required,
      batchable: Boolean(p.batchable),
    }))
    process.stdout.write(JSON.stringify({ playbooks: listing }, null, 2) + '\n')
    if (!args.playbook && !args.list) process.exitCode = 0
    return
  }

  const playbook = PLAYBOOKS[args.playbook]
  if (!playbook) {
    process.stderr.write(`Unknown playbook "${args.playbook}". Try --list.\n`)
    process.exitCode = 1
    return
  }

  let values = {}
  if (args.values) {
    try {
      values = JSON.parse(args.values)
    } catch {
      process.stderr.write('--values must be valid JSON.\n')
      process.exitCode = 1
      return
    }
  }

  const ctx = { callerName: args.caller || '', callbackNumber: args.callback || '' }
  const batch = Boolean(args.batch && playbook.batchable)
  // In batch mode the business/company name is supplied per recipient, so it is
  // not required in the shared values.
  const requiredHere = batch
    ? playbook.required.filter((k) => k !== 'business' && k !== 'company')
    : playbook.required
  const missing = requiredHere.filter((k) => !s(values, k) && !list(values, k).length)

  const out = {
    playbook: args.playbook,
    label: playbook.label,
    task:
      playbook.buildTask(values, ctx) +
      (batch ? batchHonestyDirective(args.playbook) : '') +
      languageDirective(args.language),
    result_schema: batch ? aggregateSchema(args.playbook) : playbook.buildResultSchema(values),
    missing_required: missing,
  }
  if (batch) {
    out.recipient_result_schema = playbook.buildResultSchema(values)
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
}

main()

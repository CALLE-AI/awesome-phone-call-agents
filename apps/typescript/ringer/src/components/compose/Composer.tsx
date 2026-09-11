import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
  ChevronDown,
  Layers,
  PhoneOutgoing,
  Wallet,
  Info,
  Languages,
} from 'lucide-react'
import { getTemplate } from '@/lib/tasks/templates'
import type { TaskValues } from '@/lib/tasks/types'
import { buildCall, type RecipientInput } from '@/lib/tasks/buildCall'
import type { CreatePayload, RunMode } from '@/lib/calle/client'
import { estimateCost } from '@/lib/pricing'
import { currencySymbol } from '@/lib/format'
import { currencyForRecipients, nonEnglishLanguages } from '@/lib/regions'
import { normalizePhone } from '@/lib/phone'
import { TemplateIcon, accentClasses } from '@/components/ui/icon'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/fields'
import { DynamicField } from './DynamicField'
import { RecipientEditor, newRecipient, type UiRecipient } from './RecipientEditor'
import { BillDropzone } from './BillDropzone'
import type { ParsedBill } from '@/lib/billParse'
import { cn } from '@/lib/cn'

const NAME_KEYS = ['company', 'business']

export interface LaunchMeta {
  templateId: string
  templateLabel: string
  batch: boolean
  title: string
  /** ISO 4217 currency amounts are quoted in (from the recipient region(s)). */
  currency: string
}

export function Composer({
  templateId,
  defaultCaller,
  defaultCallback,
  initialValues,
  mode,
  onBack,
  onLaunch,
  onOpenSettings,
}: {
  templateId: string
  defaultCaller: string
  defaultCallback: string
  /** Optional prefill (e.g. from a rate-watch renegotiation). */
  initialValues?: TaskValues
  /** Current run mode — drives the cost estimate and live-setup hint. */
  mode: RunMode
  onBack: () => void
  onLaunch: (payload: CreatePayload, meta: LaunchMeta) => void
  onOpenSettings?: () => void
}) {
  const template = getTemplate(templateId)
  const nameKey = useMemo(
    () => template.fields.find((f) => NAME_KEYS.includes(f.name))?.name ?? null,
    [template],
  )

  const [batch, setBatch] = useState(false)
  const [values, setValues] = useState<TaskValues>(initialValues ?? {})
  const [recipients, setRecipients] = useState<UiRecipient[]>([newRecipient()])
  const [callerName, setCallerName] = useState(defaultCaller)
  const [callbackNumber, setCallbackNumber] = useState(defaultCallback)
  const [consent, setConsent] = useState(false)
  const [showTask, setShowTask] = useState(true)
  const [attempted, setAttempted] = useState(false)

  const setValue = (name: string, value: string | string[]) =>
    setValues((v) => ({ ...v, [name]: value }))

  const isBatch = batch && Boolean(template.batchable)

  // Fields shown in the shared form (hide the name field in batch mode).
  const sharedFields = template.fields.filter((f) => !(isBatch && f.name === nameKey))

  const loadExample = () => {
    setValues(template.example.values)
    setBatch(false)
    setRecipients([{ ...newRecipient(), phoneRaw: '+1 415 555 0134' }])
  }

  /** Merge parsed-bill fields into the form (negotiate-bill only). */
  const applyBill = (bill: ParsedBill) => {
    setValues((v) => ({
      ...v,
      ...(bill.provider ? { company: bill.provider } : {}),
      ...(bill.amount != null ? { currentAmount: String(bill.amount) } : {}),
      ...(bill.accountRef ? { accountRef: bill.accountRef } : {}),
      ...(bill.planLine
        ? {
            leverage: [String(v.leverage ?? '').trim(), `My bill shows: ${bill.planLine}.`]
              .filter(Boolean)
              .join(' '),
          }
        : {}),
    }))
  }

  const enableBatch = (on: boolean) => {
    setBatch(on)
    if (on && recipients.length < 2) {
      setRecipients([
        { ...newRecipient(), businessName: '' },
        { ...newRecipient(), businessName: '' },
        { ...newRecipient(), businessName: '' },
      ])
    } else if (!on) {
      setRecipients((r) => [r[0] ?? newRecipient()])
    }
  }

  // Build recipient inputs with normalized phones.
  const recipientInputs: RecipientInput[] = recipients.map((r) => {
    const norm = normalizePhone(r.phoneRaw, r.region)
    return {
      businessName: isBatch ? r.businessName : (values[nameKey ?? ''] as string) ?? '',
      phone: norm.normalized,
      region: r.region,
      locale: r.locale,
    }
  })

  // Validation.
  const missingRequired = sharedFields
    .filter((f) => f.required)
    .filter((f) => {
      const v = values[f.name]
      return !(typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length : false)
    })

  const phoneOk = recipients.every((r) => normalizePhone(r.phoneRaw, r.region).ok)
  const namesOk = !isBatch || recipients.every((r) => r.businessName.trim().length > 0)
  const enoughRecipients = !isBatch || recipients.length >= 2
  const canLaunch =
    missingRequired.length === 0 && phoneOk && namesOk && enoughRecipients && consent

  const callCount = isBatch ? recipients.length : 1
  const cost = estimateCost(callCount)
  const callLanguages = nonEnglishLanguages(recipientInputs.map((r) => r.locale))
  // Currency the businesses quote in (null = a mixed-region batch). Follows the
  // number's country code first, then the region. Only shown when it isn't plain
  // USD, mirroring how the language chip only shows non-EN.
  const callCurrency = currencyForRecipients(recipientInputs.map((r) => ({ phone: r.phone, region: r.region })))

  const payload: CreatePayload | null = useMemo(() => {
    if (!phoneOk) return null
    try {
      return buildCall({
        template,
        values,
        identity: { callerName, callbackNumber: callbackNumber || undefined },
        recipients: recipientInputs,
        batch: isBatch,
      })
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, values, callerName, callbackNumber, recipients, isBatch])

  const schemaKeys = payload
    ? Object.keys((payload.body.recipient_result_schema ?? payload.body.result_schema ?? {}).properties ?? {})
    : []

  const handleLaunch = () => {
    setAttempted(true)
    if (!canLaunch || !payload) return
    const title = isBatch
      ? `${template.label} · ${recipients.length} businesses`
      : `${template.label}${recipientInputs[0]?.businessName ? ` · ${recipientInputs[0].businessName}` : ''}`
    onLaunch(payload, { templateId: template.id, templateLabel: template.label, batch: isBatch, title, currency: payload.currency })
  }

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <button
        onClick={onBack}
        className="mb-5 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> All playbooks
      </button>

      <div className="mb-6 flex items-start gap-3.5">
        <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${accentClasses(template.accent)}`}>
          <TemplateIcon name={template.icon} className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">{template.label}</h1>
          <p className="text-sm text-muted">{template.tagline}</p>
        </div>
        <button
          onClick={loadExample}
          className="ml-auto hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted hover:border-primary/40 hover:text-primary sm:inline-flex"
        >
          <Wand2 className="size-3.5" /> Try an example
        </button>
      </div>

      {/* Mode toggle for batchable templates */}
      {template.batchable && (
        <div className="mb-6 inline-flex rounded-xl border border-border bg-surface-2 p-1 text-sm font-semibold">
          <button
            onClick={() => enableBatch(false)}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-colors',
              !isBatch ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            <Phone className="size-4" /> Single call
          </button>
          <button
            onClick={() => enableBatch(true)}
            className={cn(
              'flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-colors',
              isBatch ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            <Layers className="size-4" /> Quote Shootout
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {/* Task details */}
        <section className="card p-5 sm:p-6">
          <SectionHeader icon={<Sparkles className="size-4" />} title="The details" />
          <div className="mt-4 flex flex-col gap-4">
            {template.id === 'negotiate-bill' && <BillDropzone onParsed={(bill) => applyBill(bill)} />}
            {sharedFields.map((f) => (
              <DynamicField key={f.name} field={f} values={values} onChange={setValue} />
            ))}
            {attempted && missingRequired.length > 0 && (
              <p className="text-xs font-medium text-danger">
                Please fill in: {missingRequired.map((f) => f.label).join(', ')}.
              </p>
            )}
          </div>
        </section>

        {/* Who to call */}
        <section className="card p-5 sm:p-6">
          <SectionHeader
            icon={<PhoneOutgoing className="size-4" />}
            title={isBatch ? 'Businesses to call' : 'Who to call'}
            hint={isBatch ? 'Ringer calls each one and compares the results.' : undefined}
          />
          <div className="mt-4">
            <RecipientEditor
              batch={isBatch}
              showNameField={isBatch}
              namePlaceholder={template.id === 'get-quote' ? 'e.g. Mike’s Auto Repair' : 'Business name'}
              recipients={recipients}
              onChange={setRecipients}
              onPickName={nameKey ? (name) => setValue(nameKey, name) : undefined}
            />
            {attempted && isBatch && !enoughRecipients && (
              <p className="mt-2 text-xs font-medium text-danger">Add at least two businesses to compare.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {callLanguages.length > 0 && (
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary-strong dark:text-primary">
                  <Languages className="size-3.5" />
                  {isBatch
                    ? `Calls conducted in ${callLanguages.join(', ')}`
                    : `Call conducted in ${callLanguages[0]}`}
                </div>
              )}
              {callCurrency && callCurrency !== 'USD' && (
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink">
                  <span className="text-sm leading-none">{currencySymbol(callCurrency)}</span>
                  Prices in {callCurrency}
                </div>
              )}
              {isBatch && callCurrency === null && (
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-muted">
                  Prices in each business’s local currency
                </div>
              )}
            </div>
          </div>
        </section>

        {/* From you */}
        <section className="card p-5 sm:p-6">
          <SectionHeader icon={<UserRound className="size-4" />} title="From you" hint="What the agent says about who it represents." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Your name" htmlFor="caller">
              <Input id="caller" placeholder="e.g. Alex Rivera" value={callerName} onChange={(e) => setCallerName(e.target.value)} />
            </Field>
            <Field label="Callback number" htmlFor="callback" help="Optional — given only if asked.">
              <Input id="callback" type="tel" placeholder="+1 415 555 0100" value={callbackNumber} onChange={(e) => setCallbackNumber(e.target.value)} />
            </Field>
          </div>
        </section>

        {/* Generated task preview */}
        {payload && (
          <section className="card overflow-hidden">
            <button
              onClick={() => setShowTask((s) => !s)}
              className="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left sm:px-6"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-ink">
                <Wand2 className="size-4 text-primary" /> The exact instruction Ringer will follow
              </span>
              <ChevronDown className={cn('size-4 text-muted transition-transform', showTask && 'rotate-180')} />
            </button>
            {showTask && (
              <div className="border-t border-border px-5 pb-5 pt-4 sm:px-6">
                <pre className="whitespace-pre-wrap rounded-xl bg-surface-2 p-4 font-mono text-[0.8rem] leading-relaxed text-ink">
                  {payload.body.task}
                </pre>
                {schemaKeys.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs font-semibold text-muted">
                      Structured data it will extract{isBatch ? ' from each call' : ''}:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {schemaKeys.map((k) => (
                        <span key={k} className="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-primary-strong dark:text-primary">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Consent */}
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface-2 p-4">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--primary)]"
          />
          <span className="text-sm leading-relaxed text-muted">
            <ShieldCheck className="mr-1 inline size-4 -translate-y-0.5 text-primary" />
            I confirm I’m authorized to place {isBatch ? 'these calls' : 'this call'} and that the number
            {isBatch ? 's are' : ' is'} correct. Ringer places calls only with explicit consent.
          </span>
        </label>

        {/* Live readiness: KYC + a phone number are required for real outbound */}
        {mode === 'live' && (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              Live calls use CALL-E credits (~{cost.formattedPerCall} each) and require identity
              verification plus a phone number on your CALL-E account.{' '}
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="cursor-pointer font-semibold text-primary hover:underline"
                >
                  Set up live calls →
                </button>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Sticky launch bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            {!consent ? (
              <p className="truncate text-xs text-muted">Confirm consent to enable the call.</p>
            ) : (
              <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                {mode === 'live' && <Wallet className="size-3.5 shrink-0 text-primary" />}
                {mode === 'demo'
                  ? `${callCount} ${callCount === 1 ? 'call' : 'calls'} · Free in Demo — no credits used`
                  : `Est. ${cost.formattedTotal} · ${callCount} ${callCount === 1 ? 'call' : 'calls'} · results in ~1 min`}
              </p>
            )}
          </div>
          <Button
            size="lg"
            variant="accent"
            disabled={!canLaunch}
            onClick={handleLaunch}
            iconLeft={<PhoneOutgoing className="size-5" />}
          >
            {isBatch ? 'Start the shootout' : 'Place the call'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-lg bg-primary-soft text-primary-strong dark:text-primary">
        {icon}
      </span>
      <div>
        <h2 className="text-[0.95rem] font-bold text-ink">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </div>
  )
}

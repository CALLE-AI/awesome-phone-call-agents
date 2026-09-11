import { motion } from 'motion/react'
import { CheckCircle2, Quote, ShieldAlert, ShieldCheck, Sparkles, XCircle } from 'lucide-react'
import type { CallTask, JsonObject } from '@/lib/calle/types'
import type { ResultFieldSpec, TaskTemplate } from '@/lib/tasks/types'
import { Badge } from '@/components/ui/Badge'
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter'
import { formatMoney, humanizeKey } from '@/lib/format'
import { currencyForRecipients } from '@/lib/regions'
import { verification } from '@/lib/honesty'
import { pop } from '@/lib/motion'

/** Render literal <br/> tags (seen in some live summaries) as line breaks. */
function cleanText(s: unknown): string {
  return String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function renderValue(spec: ResultFieldSpec, raw: unknown, currency: string): string | null {
  if (raw == null || raw === '') return null
  if (spec.kind === 'money') return formatMoney(raw, currency)
  if (spec.kind === 'boolean') return raw ? 'Yes' : 'No'
  return cleanText(raw)
}

export function OutcomeCard({ template, call, currency = 'USD' }: { template: TaskTemplate; call: CallTask; currency?: string }) {
  const result = (call.structured_result ?? {}) as JsonObject
  const evidence = call.evidence ?? []
  const outcomeVal = String(result[template.outcomeKey] ?? '')
  const outcome = template.outcomeMap[outcomeVal] ?? { tone: 'neutral' as const, label: outcomeVal || 'Result' }
  // Currency follows the number actually dialed (robust to a stale payload/region).
  const ccy = currencyForRecipients((call.recipients ?? []).map((r) => ({ phone: r.phones?.[0], region: r.region }))) ?? currency
  const headline = template.headline?.(result, ccy) ?? null

  const rows = template.resultView
    .map((spec) => ({ spec, value: renderValue(spec, result[spec.key], ccy) }))
    .filter((r) => r.value != null)

  const emphasized = rows.filter((r) => r.spec.emphasize)
  const rest = rows.filter((r) => !r.spec.emphasize)

  const good = outcome.tone === 'success'
  const v = verification(call)

  return (
    <motion.div className="card overflow-hidden" variants={pop} initial="hidden" animate="show">
      <div
        className={`flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 ${
          good ? 'bg-emerald-500/8' : outcome.tone === 'failed' ? 'bg-rose-500/8' : 'bg-surface-2'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {good ? (
            <CheckCircle2 className="size-6 text-success" />
          ) : outcome.tone === 'failed' ? (
            <XCircle className="size-6 text-danger" />
          ) : (
            <Sparkles className="size-6 text-primary" />
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Outcome</p>
            <p className="text-lg font-extrabold text-ink">{outcome.label}</p>
          </div>
        </div>
        <span title={v.hint}>
          <Badge tone={v.tone} icon={v.verified ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}>
            {v.label}
          </Badge>
        </span>
      </div>

      {!v.verified && (
        <div className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-500/8 px-5 py-3 text-xs text-amber-800 dark:text-amber-200 sm:px-6">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{v.hint}</span>
        </div>
      )}

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {headline && (
          <div className="rounded-2xl bg-gradient-to-br from-primary-soft to-transparent p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-strong dark:text-primary">
              Headline
            </p>
            <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink">{headline}</p>
          </div>
        )}

        {emphasized.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {emphasized.map(({ spec, value }) => (
              <div key={spec.key} className="card-2 p-3.5">
                <p className="text-xs font-semibold text-muted">{spec.label}</p>
                <p className="mt-0.5 truncate text-lg font-bold text-ink" title={value ?? ''}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

        {rest.length > 0 && (
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {rest.map(({ spec, value }) => (
              <div key={spec.key} className="flex flex-col border-b border-dashed border-border pb-2 last:border-0">
                <dt className="text-xs font-semibold text-muted">{spec.label}</dt>
                <dd className="text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {call.completion_confidence && <ConfidenceMeter confidence={call.completion_confidence} />}

        {evidence.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Evidence from the call</p>
            <ul className="flex flex-col gap-1.5">
              {evidence.map((e, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {call.summary && (
          <div className="whitespace-pre-line rounded-xl border border-border bg-surface-2 p-3.5 text-sm leading-relaxed text-muted">
            {cleanText(call.summary)}
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** Compact key/value dump used for custom templates / unknown keys. */
export function RawResult({ result }: { result: JsonObject }) {
  const entries = Object.entries(result).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return null
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col border-b border-dashed border-border pb-2">
          <dt className="text-xs font-semibold text-muted">{humanizeKey(k)}</dt>
          <dd className="text-sm text-ink">{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

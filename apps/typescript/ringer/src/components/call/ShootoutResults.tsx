import { useState } from 'react'
import { ChevronDown, Crown, PiggyBank, Scale } from 'lucide-react'
import type { CallRecipient, CallTask, JsonObject } from '@/lib/calle/types'
import type { TaskTemplate } from '@/lib/tasks/types'
import { Badge } from '@/components/ui/Badge'
import { TranscriptView } from './TranscriptView'
import { formatMoney } from '@/lib/format'
import { currencyForRecipients } from '@/lib/regions'
import { denominatorLine } from '@/lib/honesty'
import { cn } from '@/lib/cn'

/** Live summaries sometimes embed literal <br/> tags — render them as breaks. */
function cleanText(s: unknown): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function rank(template: TaskTemplate, recipients: CallRecipient[]): CallRecipient[] {
  if (template.id !== 'get-quote') return recipients
  return [...recipients].sort((a, b) => {
    const av = Number((a.structured_result as JsonObject | null)?.price_low ?? Infinity)
    const bv = Number((b.structured_result as JsonObject | null)?.price_low ?? Infinity)
    return av - bv
  })
}

export function ShootoutResults({ template, call, currency = 'USD' }: { template: TaskTemplate; call: CallTask; currency?: string }) {
  const ranked = rank(template, call.recipients ?? [])
  const agg = (call.structured_result ?? {}) as JsonObject
  const savings = Number(agg.potential_savings ?? 0)
  // Currency follows the actual numbers dialed — robust even when the run was
  // built with a stale region/payload currency (e.g. +234 → ₦).
  const ccy = currencyForRecipients((call.recipients ?? []).map((r) => ({ phone: r.phones?.[0], region: r.region }))) ?? currency

  return (
    <div className="flex flex-col gap-4">
      {/* Winner / savings banner */}
      {(agg.cheapest_business || savings > 0) && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-br from-primary-soft to-transparent p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-fg">
                <Crown className="size-6" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-strong dark:text-primary">
                  Best option
                </p>
                <p className="text-xl font-extrabold text-ink">
                  {String(agg.cheapest_business ?? '—')}
                  {agg.cheapest_price != null && (
                    <span className="ml-2 text-primary">{formatMoney(agg.cheapest_price, ccy)}</span>
                  )}
                </p>
              </div>
            </div>
            {savings > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2">
                <PiggyBank className="size-5 text-success" />
                <div>
                  <p className="text-lg font-extrabold leading-none text-ink">{formatMoney(savings, ccy)}</p>
                  <p className="text-xs text-muted">saved vs. priciest</p>
                </div>
              </div>
            )}
          </div>
          {call.summary && (
            <p className="whitespace-pre-line border-t border-border px-5 py-3.5 text-sm text-muted sm:px-6">{cleanText(call.summary)}</p>
          )}
        </div>
      )}

      {/* Denominator honesty: name the base and who's not counted. */}
      {denominatorLine(agg) && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-xs text-muted">
          <Scale className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-semibold text-ink">{denominatorLine(agg)}.</span>
            {typeof agg.note === 'string' && agg.note ? ` ${agg.note}` : ''}
          </span>
        </div>
      )}

      {/* Ranked recipient cards */}
      <div className="flex flex-col gap-3">
        {ranked.map((r, i) => (
          <RecipientCard key={r.id} template={template} recipient={r} currency={ccy} isWinner={i === 0 && template.id === 'get-quote'} />
        ))}
      </div>
    </div>
  )
}

function RecipientCard({
  template,
  recipient,
  currency = 'USD',
  isWinner,
}: {
  template: TaskTemplate
  recipient: CallRecipient
  currency?: string
  isWinner: boolean
}) {
  const [open, setOpen] = useState(false)
  const result = (recipient.structured_result ?? {}) as JsonObject
  const outcomeVal = String(result[template.outcomeKey] ?? '')
  const outcome = template.outcomeMap[outcomeVal] ?? { tone: 'neutral' as const, label: recipient.status }
  const headline = template.headline?.(result, currency) ?? null
  const attempts = recipient.attempts ?? []
  const attempt = attempts[attempts.length - 1]
  const turns = attempt?.transcript_turns ?? []
  // Did this recipient contribute to the comparison, or is it not counted?
  const counted = template.id === 'get-quote' ? result.price_low != null : outcomeVal === 'success'

  const rows = template.resultView
    .filter((s) => !s.emphasize)
    .map((s) => ({ label: s.label, value: result[s.key] }))
    .filter((r) => r.value != null && r.value !== '')
  const summary = cleanText(recipient.summary)
  // Live calls may not populate per-recipient transcript turns; a card is still
  // openable when there are result fields or a summary to show.
  const hasDetail = rows.length > 0 || turns.length > 0 || summary.length > 0

  return (
    <div className={cn('card overflow-hidden', isWinner && 'ring-2 ring-primary')}>
      <div className="flex items-center gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-ink">
              {attempts[0]?.phone ?? recipient.phones?.[0] ?? 'Recipient'}
            </h3>
            {isWinner && (
              <Badge tone="brand" icon={<Crown className="size-3" />}>
                Best
              </Badge>
            )}
          </div>
          {headline ? (
            <p className="text-lg font-extrabold text-primary">{headline}</p>
          ) : (
            <p className="line-clamp-2 text-sm text-muted">{summary || '—'}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          {!counted && (
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Not counted
            </span>
          )}
        </div>
      </div>

      {hasDetail && (
        <div className="border-t border-border">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted hover:text-ink sm:px-5"
          >
            {open ? 'Hide details' : 'View details'}
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5">
              {rows.length > 0 && (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {rows.map((row) => (
                    <div key={row.label} className="min-w-0">
                      <dt className="text-xs font-semibold text-muted">{row.label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm text-ink">{cleanText(row.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {summary && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">Summary</p>
                  <p className="whitespace-pre-line text-sm text-ink">{summary}</p>
                </div>
              )}
              {turns.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">Transcript</p>
                  <TranscriptView turns={turns} connecting={false} live={false} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

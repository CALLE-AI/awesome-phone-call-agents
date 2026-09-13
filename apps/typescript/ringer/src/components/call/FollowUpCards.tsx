import { useState } from 'react'
import {
  BellRing,
  CalendarPlus,
  Check,
  Clock3,
  PhoneForwarded,
  Sunrise,
  Timer,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buildIcs, downloadIcs } from '@/lib/ics'
import { inHours, tomorrowMorning } from '@/lib/followups'
import { formatMoney } from '@/lib/format'
import type { JsonObject } from '@/lib/calle/types'

/* ------------------------------------------------------------------ */
/*  Retry / escalation planner                                         */
/* ------------------------------------------------------------------ */

export function RetryPlanner({
  reason,
  onEscalateNow,
  onSchedule,
}: {
  reason: string
  onEscalateNow: () => void
  onSchedule: (dueAt: Date) => void
}) {
  const [scheduled, setScheduled] = useState<string | null>(null)

  const schedule = (dueAt: Date, label: string) => {
    onSchedule(dueAt)
    setScheduled(label)
  }

  return (
    <div className="card overflow-hidden border-sky-500/30">
      <div className="flex items-center gap-2.5 border-b border-border bg-sky-500/8 px-5 py-3.5">
        <span className="grid size-9 place-items-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <PhoneForwarded className="size-5" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            Needs a follow-up
          </p>
          <p className="text-sm font-semibold text-ink">{reason}</p>
        </div>
      </div>
      <div className="p-5">
        {scheduled ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4" /> Follow-up scheduled {scheduled}. Find it under Impact &amp; history.
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Real phone work often takes two calls. Retry now with an escalation script, or queue it
              for later — Ringer keeps the context.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              <Button size="sm" variant="accent" iconLeft={<PhoneForwarded className="size-4" />} onClick={onEscalateNow}>
                Retry now — escalate
              </Button>
              <Button size="sm" variant="outline" iconLeft={<Timer className="size-4" />} onClick={() => schedule(inHours(2), 'for 2 hours from now')}>
                In 2 hours
              </Button>
              <Button size="sm" variant="outline" iconLeft={<Sunrise className="size-4" />} onClick={() => schedule(tomorrowMorning(), 'for tomorrow 9 AM')}>
                Tomorrow 9 AM
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Add to calendar (.ics)                                             */
/* ------------------------------------------------------------------ */

export function AddToCalendar({
  result,
  title,
}: {
  result: JsonObject
  title: string
}) {
  const iso = typeof result.appointment_iso === 'string' ? result.appointment_iso : null
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null

  const download = () => {
    const ics = buildIcs({
      title,
      startIso: iso,
      durationMinutes: 60,
      location: typeof result.location === 'string' ? result.location : undefined,
      description: [
        typeof result.confirmation_number === 'string' ? `Confirmation: ${result.confirmation_number}` : '',
        typeof result.notes === 'string' ? result.notes : '',
        'Booked by Ringer.',
      ]
        .filter(Boolean)
        .join('\n'),
    })
    if (ics) downloadIcs(ics)
  }

  return (
    <Button variant="outline" iconLeft={<CalendarPlus className="size-4" />} onClick={download}>
      Add to calendar
    </Button>
  )
}

/* ------------------------------------------------------------------ */
/*  Rate watch                                                          */
/* ------------------------------------------------------------------ */

export function RateWatchCard({
  company,
  newAmount,
  promoLength,
  currency = 'USD',
  watching,
  onWatch,
}: {
  company: string
  newAmount: number | null
  promoLength: string | null
  currency?: string
  watching: boolean
  onWatch: () => void
}) {
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-strong dark:text-primary">
        <BellRing className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">
          {watching ? 'Rate Watch is on' : 'Don’t let the price creep back'}
        </p>
        <p className="text-xs leading-relaxed text-muted">
          {watching
            ? `Ringer will prompt you to renegotiate ${company} a week before the ${promoLength ?? '12 months'} promo ends.`
            : `Your ${newAmount != null ? `${formatMoney(newAmount, currency)}/mo ` : ''}promo${promoLength ? ` runs ${promoLength}` : ''}. Watch it and Ringer will queue a renegotiation call before it expires.`}
        </p>
      </div>
      {watching ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          <Clock3 className="size-3.5" /> Watching
        </span>
      ) : (
        <Button size="sm" variant="primary" iconLeft={<BellRing className="size-4" />} onClick={onWatch}>
          Watch this rate
        </Button>
      )}
    </div>
  )
}

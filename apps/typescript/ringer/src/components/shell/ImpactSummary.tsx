import { CalendarCheck, Clock3, PhoneOutgoing, PiggyBank } from 'lucide-react'
import type { ReactNode } from 'react'
import { computeImpact, type HistoryEntry } from '@/lib/app'
import { currencySymbol } from '@/lib/format'
import { CountUp } from '@/components/bits/text'

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function ImpactSummary({ history }: { history: HistoryEntry[] }) {
  const impact = computeImpact(history)

  const tiles: { show: boolean; icon: ReactNode; value: ReactNode; label: string; accent?: boolean }[] = [
    {
      show: impact.totalSaved > 0,
      icon: <PiggyBank className="size-4" />,
      value: <CountUp to={Math.round(impact.totalSaved)} prefix={currencySymbol(impact.currency)} separator="," duration={1.4} />,
      label: 'Saved & recovered',
      accent: true,
    },
    {
      show: true,
      icon: <PhoneOutgoing className="size-4" />,
      value: <CountUp to={impact.callsHandled} duration={1.2} />,
      label: 'Calls handled',
    },
    {
      show: impact.minutesSaved > 0,
      icon: <Clock3 className="size-4" />,
      value: formatMinutes(impact.minutesSaved),
      label: 'Time saved',
    },
    {
      show: impact.booked > 0,
      icon: <CalendarCheck className="size-4" />,
      value: <CountUp to={impact.booked} duration={1} />,
      label: 'Appointments booked',
    },
  ].filter((t) => t.show)

  return (
    <div className="border-b border-border bg-gradient-to-br from-primary-soft/60 to-transparent p-4">
      <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-primary-strong dark:text-primary">
        Your impact
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`rounded-xl border p-3 ${t.accent ? 'border-primary/30 bg-surface' : 'border-border bg-surface'}`}
          >
            <div className="flex items-center gap-1.5 text-muted">
              <span className={t.accent ? 'text-primary' : ''}>{t.icon}</span>
            </div>
            <p className={`mt-1 text-xl font-extrabold tabular-nums ${t.accent ? 'text-primary' : 'text-ink'}`}>
              {t.value}
            </p>
            <p className="text-[0.7rem] font-medium text-muted">{t.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

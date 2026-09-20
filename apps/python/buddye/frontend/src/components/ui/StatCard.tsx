import type { ReactNode } from 'react'
import { cx } from './Button'

/**
 * One number, with the word for what it counts.
 *
 * The number is mono and tabular on purpose. These tick — units out, calls made, minutes to the
 * address — and in a proportional face a 1 is narrower than an 8, so a counter going 18 → 19 nudges
 * everything beside it. In a row of six tiles that reads as the whole strip twitching.
 *
 * `tone` is for when the number itself is the alarm: zero volunteers available, four people
 * unaccounted for. A tile with nothing wrong with it stays black on white.
 */
export type StatTone = 'default' | 'urgent' | 'attention' | 'good' | 'accent'

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-text',
  urgent: 'text-rejected',
  attention: 'text-partial',
  good: 'text-verified-text',
  accent: 'text-accent',
}

const EDGE: Record<StatTone, string> = {
  default: 'border-border',
  urgent: 'border-border border-l-[3px] border-l-rejected',
  attention: 'border-border border-l-[3px] border-l-partial',
  good: 'border-border border-l-[3px] border-l-verified',
  accent: 'border-border border-l-[3px] border-l-accent',
}

export interface StatCardProps {
  label: ReactNode
  /** Pass what the API sent. Formatting is the caller's job; inventing a number is nobody's. */
  value: ReactNode
  /** "min", "mi", "of 14". Sits beside the value, smaller and quieter. */
  unit?: ReactNode
  /** A line under the number explaining what it means when it is not obvious. */
  hint?: ReactNode
  tone?: StatTone
  icon?: ReactNode
  /** Makes the whole tile a target. Only when there is somewhere for it to go. */
  onClick?: () => void
  className?: string
}

export function StatCard({ label, value, unit, hint, tone = 'default', icon, onClick, className }: StatCardProps) {
  const interactive = typeof onClick === 'function'
  const shell = cx(
    'flex w-full flex-col rounded border bg-surface p-3 text-left',
    EDGE[tone],
    interactive &&
      'cursor-pointer transition-colors hover:border-faint/60 hover:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35',
    className,
  )
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {icon ? <span className="text-faint">{icon}</span> : null}
        <span className="label truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cx('font-mono text-22 leading-none tabular-nums', VALUE_TONE[tone])}>{value}</span>
        {unit ? <span className="text-12 text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1.5 text-12 leading-snug text-muted">{hint}</div> : null}
    </>
  )
  // Branched rather than a dynamic tag: a tile that does nothing must not be a button, or every
  // keyboard user tabs through six dead stops on the way to the thing they came for.
  return interactive ? (
    <button type="button" onClick={onClick} className={shell}>
      {body}
    </button>
  ) : (
    <div className={shell}>{body}</div>
  )
}

/** A row of tiles. Wraps rather than scrolls: a number half off the screen is a number nobody read. */
export function StatRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4', className)}>{children}</div>
}

import type { ReactNode } from 'react'
import { cx } from './Button'

/**
 * A small piece of state, said in one or two words.
 *
 * Two families, and keeping them apart matters. `BadgeTone` is *meaning* — verified, partial,
 * rejected, neutral — and is what a status wears. `p1..p5` is the incident priority scale, and only
 * a priority wears it. Mixing them is how a console ends up with two different reds that mean two
 * different things on the same screen.
 */
export type BadgeTone = 'neutral' | 'accent' | 'verified' | 'partial' | 'rejected' | 'outline' | 'dark'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-ground text-muted',
  accent: 'bg-accent-tint text-accent',
  verified: 'bg-verified-tint text-verified-text',
  partial: 'bg-partial-tint text-partial',
  rejected: 'bg-rejected-tint text-rejected',
  outline: 'border border-edge bg-surface text-muted',
  dark: 'bg-text text-surface',
}

/** 1 is life safety. The scale is the backend's; this is only the colour it is drawn in. */
export type Priority = 1 | 2 | 3 | 4 | 5

const PRIORITY_TONE: Record<Priority, string> = {
  1: 'bg-p1-tint text-p1-text',
  2: 'bg-p2-tint text-p2-text',
  3: 'bg-p3-tint text-p3-text',
  4: 'bg-p4-tint text-p4-text',
  5: 'bg-p5-tint text-p5-text',
}

const PRIORITY_SOLID: Record<Priority, string> = {
  1: 'bg-p1', 2: 'bg-p2', 3: 'bg-p3', 4: 'bg-p4', 5: 'bg-p5',
}

export function clampPriority(priority: number | null | undefined): Priority {
  const p = Math.round(Number(priority ?? 5))
  return (p < 1 ? 1 : p > 5 ? 5 : p) as Priority
}

export interface BadgeProps {
  tone?: BadgeTone
  /** Overrides `tone` with the priority scale. Pass the number the API sent, unmodified. */
  priority?: number | null
  /** A filled circle in front, in the badge's own colour. For anything currently happening. */
  dot?: boolean
  /** The dot breathes. Only for something live on a phone line or on the road right now. */
  pulse?: boolean
  size?: 'sm' | 'md'
  className?: string
  title?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', priority = null, dot = false, pulse = false, size = 'md', className, title, children }: BadgeProps) {
  const palette = priority != null ? PRIORITY_TONE[clampPriority(priority)] : TONE[tone]
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center rounded-pill font-medium leading-[16px]',
        size === 'sm' ? 'gap-1 px-1.5 py-px text-11' : 'gap-1.5 px-2 py-0.5 text-12',
        palette,
        className,
      )}
    >
      {dot ? <span className={cx('h-[6px] w-[6px] shrink-0 rounded-full bg-current', pulse && 'animate-pulseDot')} /> : null}
      {children}
    </span>
  )
}

/**
 * The priority itself, as a compact "P1" chip. The label — "Life safety", "Routine" — comes from
 * the backend's `priority_label`; this never invents its own words for the scale.
 */
export function PriorityBadge({ priority, label, className }: { priority: number | null | undefined; label?: string; className?: string }) {
  const p = clampPriority(priority)
  return (
    <Badge priority={p} size="sm" className={cx('font-mono', className)} title={label}>
      P{p}
      {label ? <span className="font-sans font-medium">{label}</span> : null}
    </Badge>
  )
}

/**
 * A bare number: a count on a rail row, a tab, a header.
 *
 * Mono, because a count that ticks 9 → 10 in a proportional face shifts everything beside it.
 */
export function CountBadge({ value, tone = 'neutral', priority = null, className }: { value: number; tone?: BadgeTone; priority?: number | null; className?: string }) {
  const palette = priority != null ? `${PRIORITY_SOLID[clampPriority(priority)]} text-surface` : TONE[tone]
  return (
    <span
      className={cx(
        'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-pill px-1 font-mono text-11 leading-none tabular-nums',
        palette,
        className,
      )}
    >
      {value}
    </span>
  )
}

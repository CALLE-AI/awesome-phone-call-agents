import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './Button'

/**
 * A bounded surface. The quietest thing in the system on purpose: 1px border, 6px radius, white,
 * no shadow unless it is floating above something.
 *
 * `tone` is the one exception, and it is spent carefully. A card only wears a colour when the card
 * *is* the alarm — the "needs you now" stack, an unapproved agency request — so that a tired
 * person sees the colour before she reads a word. Everything else is a badge inside a plain card.
 */
export type CardTone = 'default' | 'urgent' | 'attention' | 'calm' | 'accent'

const TONE: Record<CardTone, string> = {
  default: 'border-border',
  urgent: 'border-border border-l-[3px] border-l-rejected bg-rejected-tint/40',
  attention: 'border-border border-l-[3px] border-l-partial bg-partial-tint/40',
  calm: 'border-border border-l-[3px] border-l-verified',
  accent: 'border-border border-l-[3px] border-l-accent bg-accent-tint/30',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone
  /** Inner padding. `false` when the card holds a table or a map that must reach the edge. */
  padded?: boolean
  /** Lifts on hover. Only for a card that is genuinely a link or opens something. */
  interactive?: boolean
  /** Floats it above the page. For overlays and popovers, not for rows in a list. */
  raised?: boolean
  children?: ReactNode
}

export function Card({ tone = 'default', padded = true, interactive = false, raised = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'rounded border bg-surface',
        TONE[tone],
        padded && 'p-4',
        raised && 'shadow-panel',
        interactive && 'cursor-pointer transition-colors hover:border-faint/60 hover:bg-active',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/** A card's own heading row: title on the left, whatever acts on it on the right. */
export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="text-14 font-semibold leading-tight text-text">{title}</div>
        {subtitle ? <div className="mt-0.5 text-12 leading-snug text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** A hairline across a card, where two things inside it are genuinely separate. */
export function CardDivider({ className }: { className?: string }) {
  return <hr className={cx('my-3 border-0 border-t border-divider', className)} />
}

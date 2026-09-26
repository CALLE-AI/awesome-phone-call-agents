import type { ReactNode } from 'react'
import { cx } from './Button'

/**
 * What a region says when it has nothing in it.
 *
 * Worth being careful about in this product, because an empty list is ambiguous in a way that
 * matters: "nobody needs help" and "nothing has happened yet" look identical, and only one of them
 * is good news. So `title` is expected to say which — "Nobody is waiting on you" rather than
 * "No items" — and `body` is where the reason goes.
 *
 * Quiet by design. An empty state that shouts competes with the parts of the screen that have
 * something to report.
 */
export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  /** A button or a link. Only when there is genuinely something to do about the emptiness. */
  action?: ReactNode
  /** `compact` for an empty panel body; `full` when the empty state is the whole page. */
  size?: 'compact' | 'full'
  className?: string
}

export function EmptyState({ icon, title, body, action, size = 'compact', className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        size === 'full' ? 'gap-2 px-6 py-16' : 'gap-1.5 px-4 py-8',
        className,
      )}
    >
      {icon ? <span className="mb-0.5 text-edge">{icon}</span> : null}
      <p className={cx('font-medium text-text', size === 'full' ? 'text-15' : 'text-13')}>{title}</p>
      {body ? <p className="max-w-[46ch] text-12 leading-relaxed text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

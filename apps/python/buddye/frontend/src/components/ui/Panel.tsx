import type { ReactNode } from 'react'
import { cx } from './Button'

/**
 * A titled section of a page.
 *
 * The difference between this and `Card` is what it is for, not how it looks: a `Card` is an object
 * — one incident, one person — and a `Panel` is a region of the screen with a name over it. Pages
 * are built out of panels; lists inside them are built out of cards or rows.
 *
 * The header is a 11px uppercase label rather than a heading-sized title. On a screen with six
 * regions on it, six big titles compete with the data; a quiet label lets the numbers be the thing
 * you see first, which is the whole posture of this console.
 */
export interface PanelProps {
  title: ReactNode
  /** A sentence under the title. Use it to say what the panel means, not to repeat the title. */
  subtitle?: ReactNode
  /** Buttons, filters, a count. Right-aligned in the header row. */
  actions?: ReactNode
  /** Inner padding on the body. `false` when the body is a table or a map. */
  padded?: boolean
  /** Caps the body height and scrolls it. A number in px, or a Tailwind max-height class. */
  scroll?: number | string
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}

export function Panel({ title, subtitle, actions, padded = true, scroll, footer, className, bodyClassName, children }: PanelProps) {
  const scrollStyle = typeof scroll === 'number' ? { maxHeight: scroll } : undefined
  const scrollClass = typeof scroll === 'string' ? scroll : undefined
  return (
    <section className={cx('overflow-hidden rounded border border-border bg-surface', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-divider bg-strip px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="label truncate">{title}</h2>
          {subtitle ? <p className="mt-1 text-12 leading-snug text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div
        className={cx(padded && 'p-4', (scroll != null) && 'thin-scroll overflow-y-auto', scrollClass, bodyClassName)}
        style={scrollStyle}
      >
        {children}
      </div>
      {footer ? <footer className="border-t border-divider bg-strip px-4 py-2.5 text-12 text-muted">{footer}</footer> : null}
    </section>
  )
}

/**
 * Two or more panels that belong together, on one baseline.
 *
 * `cols` is the count at desktop width; everything stacks below `lg`. Real emergency software gets
 * read on a phone at nine at night as often as on a desk.
 */
export function PanelGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3 | 4; className?: string; children: ReactNode }) {
  const grid = cols === 1 ? '' : cols === 2 ? 'lg:grid-cols-2' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2 xl:grid-cols-4'
  return <div className={cx('grid grid-cols-1 gap-4', grid, className)}>{children}</div>
}

/** A label/value pair, as it appears inside a panel body. The console's smallest unit of fact. */
export function Fact({ label, value, mono = false, className }: { label: ReactNode; value: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="label">{label}</div>
      <div className={cx('mt-1 text-13 text-text', mono && 'font-mono tabular-nums')}>{value}</div>
    </div>
  )
}

import { useEffect } from 'react'
import { CloseIcon } from './Icons'

/**
 * The detail surface: a full-height sheet from the right on a desktop, full screen on a phone.
 *
 * It is an overlay rather than a route on purpose. Navigating away would tear down the SSE
 * connection, and the moment a captain most wants to open somebody's detail is while the sweep is
 * still calling the rest of the block.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/25 animate-fadeIn" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[560px] flex-col border-l border-border bg-ground shadow-xl animate-fadeIn">
        <header className="flex shrink-0 items-start gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-20 font-semibold leading-tight text-text">{title}</h2>
            {subtitle ? <div className="mt-1 text-12 text-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted hover:bg-ground"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border bg-surface px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">{title}</span>
        {right}
      </div>
      {children}
    </section>
  )
}

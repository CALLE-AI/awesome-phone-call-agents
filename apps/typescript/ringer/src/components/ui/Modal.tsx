import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useLenis } from 'lenis/react'
import { cn } from '@/lib/cn'

export function Modal({
  open,
  onClose,
  title,
  children,
  side = false,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Render as a right-side drawer instead of a centered dialog. */
  side?: boolean
  className?: string
}) {
  const lenis = useLenis()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    lenis?.stop()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      lenis?.start()
    }
  }, [open, onClose, lenis])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-float-up"
        onClick={onClose}
      />
      <div
        className={cn(
          'card soft-shadow relative z-10 flex max-h-[90vh] flex-col overflow-hidden animate-float-up',
          side
            ? 'ml-auto h-full w-full max-w-md rounded-none rounded-l-3xl'
            : 'm-auto w-full max-w-lg rounded-3xl',
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-extrabold text-ink">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

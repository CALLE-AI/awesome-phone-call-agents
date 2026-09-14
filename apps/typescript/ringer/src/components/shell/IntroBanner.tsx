import { FlaskConical, X } from 'lucide-react'

export function IntroBanner({ onDismiss, onOpenSettings }: { onDismiss: () => void; onOpenSettings: () => void }) {
  return (
    <div className="border-b border-primary/20 bg-primary-soft/50">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
        <FlaskConical className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm text-ink">
          <span className="font-semibold">You’re in Demo Mode</span>
          <span className="text-muted"> — try any call free, no phone or API key needed. Flip to </span>
          <button onClick={onOpenSettings} className="cursor-pointer font-semibold text-primary hover:underline">
            Live in Settings
          </button>
          <span className="text-muted"> to place real calls with your CALL-E key.</span>
        </p>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

import { cn } from '@/lib/cn'
import type { CompletionConfidence } from '@/lib/calle/types'

export function ConfidenceMeter({
  confidence,
  className,
}: {
  confidence: CompletionConfidence
  className?: string
}) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence.score)) * 100)
  const tone =
    confidence.score >= 0.8 ? 'bg-emerald-500' : confidence.score >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted">Completion confidence</span>
        <span className="font-mono font-semibold text-ink">
          {pct}% · {confidence.label}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-out', tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

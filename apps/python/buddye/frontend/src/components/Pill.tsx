import { cn } from '../lib/utils'

export type PillTone = 'accent' | 'verified' | 'partial' | 'rejected' | 'grey'

const TONE: Record<PillTone, string> = {
  accent: 'bg-accent-tint text-accent',
  verified: 'bg-verified-tint text-verified-text',
  partial: 'bg-partial-tint text-partial',
  rejected: 'bg-rejected-tint text-rejected',
  grey: 'bg-ground text-muted',
}

export function Pill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={cn('pill', TONE[tone], className)}>{children}</span>
}

/** A pill with a live dot in front of it, for anything currently happening on a phone line. */
export function LivePill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className={cn('pill gap-1.5', TONE[tone])}>
      <span className="h-[6px] w-[6px] animate-pulseDot rounded-full bg-current" />
      {children}
    </span>
  )
}

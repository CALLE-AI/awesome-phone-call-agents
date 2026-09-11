import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { OutcomeTone } from '@/lib/tasks/types'

type Tone = OutcomeTone | 'brand' | 'info'

const tones: Record<Tone, string> = {
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25',
  partial: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-500/25',
  failed: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/25',
  pending: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/25',
  neutral: 'bg-surface-2 text-muted ring-border',
  brand: 'bg-primary-soft text-primary-strong dark:text-primary ring-primary/25',
  info: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/25',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

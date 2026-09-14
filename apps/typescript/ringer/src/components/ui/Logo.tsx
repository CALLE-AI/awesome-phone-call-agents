import { cn } from '@/lib/cn'
import { Waveform } from './Waveform'

export function LogoMark({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <span
      className={cn(
        'inline-grid place-items-center rounded-xl bg-primary text-primary-fg shadow-sm',
        'size-9',
        className,
      )}
    >
      <Waveform bars={4} active={active} className="text-primary-fg" barClassName="h-3.5" />
    </span>
  )
}

export function Logo({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark active={active} />
      <span className="text-[1.15rem] font-extrabold tracking-tight text-ink">
        Ringer
      </span>
    </span>
  )
}

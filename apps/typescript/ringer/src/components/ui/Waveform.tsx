import { cn } from '@/lib/cn'

interface WaveformProps {
  /** Number of bars. */
  bars?: number
  className?: string
  /** Animate the bars (a live call) vs. static idle. */
  active?: boolean
  barClassName?: string
}

/** Animated equalizer bars — the core voice/telecom motif. */
export function Waveform({ bars = 5, active = true, className, barClassName }: WaveformProps) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] rounded-full bg-current',
            active ? 'h-4' : 'h-2 opacity-60',
            barClassName,
          )}
          style={
            active
              ? {
                  animation: `ring-wave 1s ease-in-out ${(i % bars) * 0.12}s infinite`,
                  transformOrigin: 'center',
                }
              : undefined
          }
        />
      ))}
    </span>
  )
}

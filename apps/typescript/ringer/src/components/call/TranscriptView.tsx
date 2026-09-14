import { PhoneCall } from 'lucide-react'
import type { CallTranscriptTurn } from '@/lib/calle/types'
import { formatOffset } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Waveform } from '@/components/ui/Waveform'

export function TranscriptView({
  turns,
  connecting,
  live,
}: {
  turns: CallTranscriptTurn[]
  connecting: boolean
  live: boolean
}) {
  if (connecting) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <span className="relative grid size-14 place-items-center rounded-full bg-primary-soft text-primary-strong dark:text-primary">
          <PhoneCall className="size-6 animate-pulse" />
        </span>
        <p className="text-sm font-semibold text-ink">Dialing & navigating the phone menu…</p>
        <Waveform bars={7} className="text-primary" barClassName="h-5" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {turns.map((t, i) => {
        const isRinger = t.speaker === 'bot'
        return (
          <div
            key={i}
            className={cn('flex animate-float-up flex-col gap-1', isRinger ? 'items-end' : 'items-start')}
          >
            <div className="flex items-center gap-2 px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-faint">
              {isRinger ? (
                <>
                  {t.offset_seconds != null && <span className="font-mono">{formatOffset(t.offset_seconds)}</span>}
                  <span className="text-primary">Ringer</span>
                </>
              ) : (
                <>
                  <span>Them</span>
                  {t.offset_seconds != null && <span className="font-mono">{formatOffset(t.offset_seconds)}</span>}
                </>
              )}
            </div>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.95rem] leading-relaxed',
                isRinger
                  ? 'rounded-br-md bg-primary text-primary-fg'
                  : 'rounded-bl-md border border-border bg-surface-2 text-ink',
              )}
            >
              {t.text}
            </div>
          </div>
        )
      })}
      {live && turns.length > 0 && (
        <div className="flex items-center gap-2 px-1 py-1 text-xs text-faint">
          <Waveform bars={4} className="text-primary" barClassName="h-3" />
          listening…
        </div>
      )}
    </div>
  )
}

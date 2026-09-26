import { useEffect, useRef } from 'react'
import { cn, normalizeQuote } from '../lib/utils'
import type { TranscriptTurn } from '../types'

/**
 * The conversation, as it happened.
 *
 * `highlightQuote` is the line `decide()` pulled out as the most alarming thing they said. Marking
 * it in place matters: a captain reading "I haven't been able to get up today" wants to see what was
 * said either side of it before she decides what to do, and a quote lifted out of a card on its own
 * is exactly how a sentence gets read as worse or better than it was.
 */
export function TranscriptCard({
  turns,
  live,
  speakerName,
  highlightQuote,
}: {
  turns: TranscriptTurn[]
  live: boolean
  speakerName: string | null
  highlightQuote?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && live) el.scrollTop = el.scrollHeight
  }, [turns.length, live])

  const q = highlightQuote ? normalizeQuote(highlightQuote) : ''
  let highlighted = -1
  if (q) {
    highlighted = turns.findIndex((t) => {
      if (t.speaker === 'bot') return false
      const n = normalizeQuote(t.text)
      return n === q || n.includes(q) || q.includes(n)
    })
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-divider px-3.5 py-2.5">
        <span className="label">What was said</span>
        <span className="font-mono text-11 text-faint">
          {turns.length} turns{live ? ' · live' : ''}
        </span>
      </div>
      <div ref={ref} className="thin-scroll flex max-h-[340px] flex-col gap-2 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 && (
          <span className="text-12 text-faint">
            {live ? 'Waiting for the call to connect…' : 'Nothing was said — nobody picked up.'}
          </span>
        )}
        {turns.map((t, i) => {
          const bot = t.speaker === 'bot'
          const speaker = bot ? 'BuddyE' : t.speaker === 'user' ? (speakerName ?? 'them') : t.speaker
          return (
            <div key={i} className={cn('grid grid-cols-[58px_minmax(0,1fr)] gap-2.5', live && 'animate-fadeIn')}>
              <span className={cn('truncate pt-0.5 font-mono text-11', bot ? 'text-faint' : 'text-accent')}>{speaker}</span>
              <span
                className={cn(
                  'text-13 leading-[1.5] text-text',
                  i === highlighted && '-mx-1 rounded-[2px] bg-partial-tint px-1',
                )}
              >
                {t.text}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

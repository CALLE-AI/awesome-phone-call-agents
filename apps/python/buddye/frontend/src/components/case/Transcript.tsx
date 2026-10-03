import { useEffect, useRef } from 'react'
import type { TranscriptTurn } from '../../types'
import { cx } from '../ui/Button'

/**
 * The conversation, turn by turn.
 *
 * The person's own words are the evidence for every other panel on the case page, so they are
 * shown in full rather than summarised, and the two speakers are told apart by weight and
 * alignment rather than by colour — a transcript painted in two hues reads as a chat toy, and this
 * is the record of a welfare call.
 *
 * `offset_seconds` is rendered in mono because it is a number in a column; the text is not, because
 * it is speech.
 */

function mmss(offset: number | null | undefined): string {
  if (offset == null || !Number.isFinite(offset)) return ''
  const s = Math.max(0, Math.round(offset))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface TranscriptProps {
  turns: TranscriptTurn[]
  /** While the call is running, keep the newest turn in view as it lands. */
  follow?: boolean
  /** Caps the height and scrolls inside. A finished call reads better uncapped. */
  maxHeight?: number
  className?: string
}

export function Transcript({ turns, follow = false, maxHeight, className }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [follow, turns.length])

  if (!turns.length) return null

  return (
    <div
      className={cx('thin-scroll space-y-2', maxHeight != null && 'overflow-y-auto pr-1', className)}
      style={maxHeight != null ? { maxHeight } : undefined}
    >
      {turns.map((turn, i) => {
        // Anything that is not the caller is treated as the person on the line. The provider names
        // the neighbour's side differently across backends ("user", "human", the callee's name),
        // and defaulting the unknown case to "them" is the safer way round: mislabelling BuddyE's
        // own script as the neighbour's words would put sentences in a frail person's mouth.
        const bot = turn.speaker === 'bot' || turn.speaker === 'assistant' || turn.speaker === 'agent'
        const stamp = mmss(turn.offset_seconds)
        return (
          <div key={`${i}-${stamp}`} className="flex gap-2.5">
            <span className="w-8 shrink-0 pt-0.5 text-right font-mono text-11 tabular-nums text-faint">{stamp}</span>
            <div className="min-w-0 flex-1">
              <span className={cx('mr-1.5 text-11 uppercase', bot ? 'text-faint' : 'font-semibold text-muted')} style={{ letterSpacing: '0.06em' }}>
                {bot ? 'BuddyE' : 'Them'}
              </span>
              <span className={cx('text-13 leading-relaxed', bot ? 'text-muted' : 'text-text')}>{turn.text}</span>
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}

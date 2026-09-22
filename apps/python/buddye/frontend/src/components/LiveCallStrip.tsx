import { LivePill } from './Pill'
import { PhoneIcon } from './Icons'
import { phaseLabel, phaseTone } from '../lib/status'
import { firstName } from '../lib/utils'
import type { CallView } from '../types'

/**
 * What is happening on a phone line this second.
 *
 * The last turn is shown rather than the whole transcript: the captain is watching this while the
 * sweep works down the block, and a scrolling wall of dialogue at the top of the board would bury
 * the things that already need her. The full conversation is one tap away in the person's detail.
 *
 * `callee` is spelled out. "Calling Elena Delgado about Rosa" is a materially different sentence
 * from "Calling Rosa Delgado", and confusing the two is how a captain concludes she has spoken to
 * someone she has not.
 */
export function LiveCallStrip({ call, onOpen }: { call: CallView; onOpen: () => void }) {
  const turns = call.transcript ?? call.liveTurns
  const last = turns.length ? turns[turns.length - 1] : null
  const speaker = last ? (last.speaker === 'bot' ? 'BuddyE' : firstName(call.to_name) || 'them') : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-4 flex w-full items-start gap-3 rounded border border-accent/30 bg-accent-tint/50 px-4 py-3 text-left"
    >
      <span className="mt-0.5 shrink-0 text-accent">
        <PhoneIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-14 font-medium text-text">
            {call.callee === 'emergency_contact' ? `Calling ${call.to_name}` : call.to_name}
          </span>
          <LivePill tone={phaseTone(call.phase)}>{phaseLabel(call.phase)}</LivePill>
          {call.callee === 'emergency_contact' && (
            <span className="text-11 text-muted">the person they nominated</span>
          )}
        </span>
        {last ? (
          <span className="mt-1.5 block truncate text-13 leading-snug text-muted">
            <span className="font-mono text-11 text-faint">{speaker} </span>
            {last.text}
          </span>
        ) : (
          <span className="mt-1.5 block text-12 text-faint">Ringing {call.phone_masked.replace(/\*/g, '•')}…</span>
        )}
      </span>
    </button>
  )
}

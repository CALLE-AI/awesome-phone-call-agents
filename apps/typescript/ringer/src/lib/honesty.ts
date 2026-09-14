/**
 * Outcome honesty — the rule that Ringer won't assert a result it can't stand
 * behind, and won't hide its denominator.
 *
 * Two ideas:
 *  1. Verification gate: a completed call is only "evidence-backed" when CALL-E
 *     reported enough confidence AND left quoted evidence. Otherwise the outcome
 *     is shown as "needs review" — tentative, check the transcript.
 *  2. Denominator honesty: a batch (Quote Shootout) result names how many were
 *     called, reached, and answered, and never counts the unreached as anything.
 */
import type { CallTask, JsonObject } from './calle/types'

/** Minimum completion confidence for an outcome to count as evidence-backed. */
export const VERIFY_THRESHOLD = 0.5

export interface Verification {
  verified: boolean
  label: string
  hint: string
  tone: 'success' | 'partial'
}

export function isOutcomeVerified(call: CallTask): boolean {
  const score = call.completion_confidence?.score ?? 0
  const evidence = call.evidence ?? []
  return score >= VERIFY_THRESHOLD && evidence.length > 0
}

/** Badge + hint describing whether the outcome can be trusted at face value. */
export function verification(call: CallTask): Verification {
  if (isOutcomeVerified(call)) {
    return {
      verified: true,
      label: 'Evidence-backed',
      hint: 'CALL-E reported high confidence and quoted evidence for this result.',
      tone: 'success',
    }
  }
  return {
    verified: false,
    label: 'Needs review',
    hint: 'The agent could not fully confirm this — treat it as tentative and check the transcript before acting.',
    tone: 'partial',
  }
}

/**
 * One-line, honest denominator for a batch result: how many gave a usable
 * answer, out of how many were called, and how many were never reached (and so
 * are not counted). Returns null when there's nothing to qualify.
 */
export function denominatorLine(agg: JsonObject): string | null {
  const called = intOf(agg.businesses_called ?? agg.recipients_called)
  if (called == null || called <= 0) return null
  const answered = intOf(agg.quotes_received ?? agg.completed_count) ?? 0
  const reached = intOf(agg.reached) ?? answered
  const notReached = Math.max(0, called - reached)
  const reachedNoAnswer = Math.max(0, reached - answered)

  const noun = agg.quotes_received != null ? 'quoted' : 'answered'
  const parts = [`${answered} ${noun} of ${called} called`]
  if (notReached > 0) parts.push(`${notReached} not reached`)
  if (reachedNoAnswer > 0) parts.push(`${reachedNoAnswer} declined`)
  const tail = notReached > 0 || reachedNoAnswer > 0 ? ' — not counted' : ''
  return parts.join(' · ') + tail
}

function intOf(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

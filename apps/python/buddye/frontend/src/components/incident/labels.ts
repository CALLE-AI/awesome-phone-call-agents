/**
 * The words the decision screens need that `lib/operator.ts` does not already have.
 *
 * Nothing here re-implements something that exists. `kindLabel`, `dispatchLabel`, `needsSentence`,
 * `priorityTone` and the rest are imported from `lib/operator.ts` wherever they fit; this file is
 * only the gaps, and each gap is here for a reason:
 *
 *  * `HANDED_OFF` is a real `IncidentStatus` in `app/domain/state.py` and is missing from both the
 *    TS union and `INCIDENT_META`, so `incidentStatusLabel()` would print the raw enum on the one
 *    status that matters most — the case that went to an agency. It gets its own wording here.
 *  * A *decision* has an outcome vocabulary of its own — approved, denied, committed by an agent,
 *    still waiting — which is not a dispatch status and must not borrow one, because "approved" and
 *    "committed by an agent" are the same `DispatchStatus` and completely different facts about who
 *    is responsible.
 *  * `afterwards()` says what happened after the decision, from timestamps only.
 */
import type { BadgeTone } from '../ui/Badge'
import type { PillTone } from '../Pill'
import type { DispatchRow, OperatorAction } from '../../types'

/** `lib/status.ts` and `lib/operator.ts` speak `PillTone`; the new primitives speak `BadgeTone`. */
export function badgeTone(tone: PillTone): BadgeTone {
  return tone === 'grey' ? 'neutral' : tone
}

// ---------------------------------------------------------------------------
// Case status
// ---------------------------------------------------------------------------
const CASE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: 'Nothing sent', tone: 'rejected' },
  TRIAGED: { label: 'Needs decided', tone: 'partial' },
  DISPATCHED: { label: 'Unit assigned', tone: 'accent' },
  ON_SCENE: { label: 'Somebody is there', tone: 'verified' },
  RESOLVED: { label: 'Closed', tone: 'neutral' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  // The backend's own word for a case a named human released to an agency. Without this entry the
  // UI would print HANDED_OFF at a coordinator, on the one status where wording matters most.
  HANDED_OFF: { label: 'Handed to an agency', tone: 'partial' },
}

export function caseStatusLabel(status: string | null | undefined): string {
  return CASE_STATUS[String(status ?? '')]?.label ?? String(status ?? 'unknown')
}

export function caseStatusTone(status: string | null | undefined): BadgeTone {
  return CASE_STATUS[String(status ?? '')]?.tone ?? 'neutral'
}

/** Open in the backend's sense: `app/api/incidents.py::OPEN_STATUSES`. */
export function caseIsOpen(status: string | null | undefined): boolean {
  const s = String(status ?? '')
  return s === 'OPEN' || s === 'TRIAGED' || s === 'DISPATCHED' || s === 'ON_SCENE'
}

// ---------------------------------------------------------------------------
// The agent's grounds for a proposal
// ---------------------------------------------------------------------------
/**
 * Why this unit, in the agent's own words.
 *
 * Mirrors `app/api/dispatch.py::_justification`: the last `dispatch_proposal` action whose output
 * names this asset. Read off the provenance row rather than re-derived from the incident, because
 * the question a coordinator asks a week later is "what did it know when it said that", and a
 * sentence rebuilt from today's state is not an answer to it.
 *
 * `/api/dispatch/pending` already computes this server-side for agency requests, so callers should
 * pass that string as `preferred` and let this fall back for community units.
 */
export function justificationFor(
  actions: readonly OperatorAction[] | undefined,
  assetId: string,
  preferred = '',
): string {
  if (preferred.trim()) return preferred
  for (let i = (actions?.length ?? 0) - 1; i >= 0; i -= 1) {
    const action = actions![i]
    if (action.kind !== 'dispatch_proposal') continue
    if (String(action.output?.asset_id ?? '') !== assetId) continue
    const justification = String(action.output?.justification ?? '')
    return justification || action.rationale || ''
  }
  return ''
}

/** Did a model write this, or did the deterministic picker? The provenance row says so. */
export function proposalSource(actions: readonly OperatorAction[] | undefined, assetId: string): string {
  for (let i = (actions?.length ?? 0) - 1; i >= 0; i -= 1) {
    const action = actions![i]
    if (action.kind !== 'dispatch_proposal') continue
    if (String(action.output?.asset_id ?? '') !== assetId) continue
    const model = String(action.output?.model ?? action.model ?? '')
    if (model) return model
    const fallback = String(action.output?.fallback_reason ?? '')
    return fallback ? `deterministic — ${fallback}` : 'deterministic'
  }
  return ''
}

// ---------------------------------------------------------------------------
// What happened after the decision
// ---------------------------------------------------------------------------
/**
 * The consequence of a decision, from timestamps only.
 *
 * Deliberately says "nothing has been sent" rather than leaving a blank: an empty cell in a record
 * of decisions reads as missing data, and "nobody went" is a finding, not a gap.
 */
export function afterwards(d: Pick<DispatchRow, 'status' | 'progress' | 'arrived_at' | 'completed_at'>): string {
  switch (d.status) {
    case 'COMPLETED':
      return 'Visit finished'
    case 'ARRIVED':
      return 'At the address'
    case 'EN_ROUTE':
      return `On the road — ${Math.round((d.progress ?? 0) * 100)}% of the way`
    case 'COMMITTED':
      return 'Assigned, not yet rolling'
    case 'CANCELLED':
      return 'Stood down — nobody went'
    default:
      return 'Nothing has been sent'
  }
}

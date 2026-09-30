/**
 * The record, derived.
 *
 * Approvals is not a work queue and holds no controls: it is the audit trail an emergency
 * programme is judged on. So this module turns the rows the console already has — every dispatch on
 * every incident, plus every responder handoff packet — into one chronological list of *decisions*,
 * each carrying who asked, on what grounds, who decided, what they said, and what happened next.
 *
 * Two rules govern everything here.
 *
 *  1. **Nothing is invented.** Every field is copied from an API payload or formatted from one. A
 *     decision with no name on it says so; it does not borrow the block captain's.
 *  2. **Who decided is never blurred.** An agent committing a wellness van and a person authorising
 *     an ambulance are the same `DispatchStatus`, and conflating them would erase the only
 *     distinction this product exists to hold. `Verdict` separates them by construction.
 */
import { isAgency, kindLabel } from '../../lib/operator'
import { afterwards } from './labels'
import type { HandoffPacket, IncidentRow, PendingDispatch } from '../../types'

/** What was decided, and by whom. `auto` is the one verdict with no human in it. */
export type Verdict = 'approved' | 'denied' | 'auto' | 'waiting' | 'proposed' | 'released' | 'prepared'

export interface DecisionRow {
  /** The dispatch or packet id: stable, and what the row is keyed on. */
  id: string
  kind: 'dispatch' | 'handoff'
  /** When the decision was taken, or when it was prepared if nobody has decided yet. */
  at: string
  /** True while `at` is a preparation time rather than a decision time. */
  undecided: boolean
  incidentId: string | null
  neighbourId: string
  name: string
  address: string
  priority: number | null
  priorityLabel: string
  /** "Ambulance R-25", "Responder handoff packet". */
  resource: string
  assetKind: string
  /** Did this need a named human? `requires_authorisation` off the row, never re-derived. */
  agency: boolean
  /** Who asked for it: the agent, or the ladder. */
  requestedBy: string
  verdict: Verdict
  /** The person who decided. Empty when nobody has. */
  decidedBy: string
  /** What they said when they decided: an approval note, or the reason for a denial. */
  said: string
  /** The grounds the request was made on. */
  basis: string
  /** What happened after the decision. */
  after: string
}

/**
 * Who said no, and why, out of one field.
 *
 * `app/orchestrator/dispatch.py::decline` writes `decline_reason` as exactly
 * `"declined by {name}: {reason}"` — the name is not on a column of its own. Splitting it here is
 * what lets the record name the person who refused an ambulance in the same column as the person
 * who approved one, which is the whole point of keeping denials.
 */
export function declineParts(declineReason: string): { by: string; why: string } {
  const m = /^declined by ([^:]+): ([\s\S]+)$/.exec(declineReason.trim())
  return m ? { by: m[1].trim(), why: m[2].trim() } : { by: '', why: declineReason.trim() }
}

const VERDICT_WORD: Record<Verdict, string> = {
  approved: 'Approved',
  denied: 'Denied',
  auto: 'Committed by an agent',
  waiting: 'Waiting on a person',
  proposed: 'Proposed, not sent',
  released: 'Released to an agency',
  prepared: 'Prepared, not released',
}

export function verdictWord(verdict: Verdict): string {
  return VERDICT_WORD[verdict]
}

/** A verdict a person is responsible for. Used to say how much of the record is human-decided. */
export function isHumanVerdict(verdict: Verdict): boolean {
  return verdict === 'approved' || verdict === 'denied' || verdict === 'released'
}

/**
 * Every decision on this hazard, newest first.
 *
 * `pending` is only consulted for the agent's justification, which `/api/dispatch/pending` computes
 * server-side. The rows themselves come from the incidents, so a request whose incident has already
 * been closed out still appears — a decision does not stop existing because the case did.
 */
export function decisionsFor(
  incidents: readonly IncidentRow[],
  packets: readonly HandoffPacket[],
  pending: readonly PendingDispatch[],
): DecisionRow[] {
  const justification = new Map(pending.map((p) => [p.id, p.justification]))
  const rows: DecisionRow[] = []

  for (const incident of incidents) {
    for (const d of incident.dispatches) {
      const agency = isAgency(d)
      const declined = d.status === 'CANCELLED'
      // A cancelled dispatch with nobody's name and no reason on it was stood down by the system,
      // not refused by a person, and calling that a denial would put words in somebody's mouth.
      const decided = !!d.authorised_by || !!d.decline_reason
      const verdict: Verdict = declined
        ? decided
          ? 'denied'
          : 'proposed'
        : d.status === 'PROPOSED'
          ? agency
            ? 'waiting'
            : 'proposed'
          : agency
            ? 'approved'
            : 'auto'
      const undecided = verdict === 'waiting' || verdict === 'proposed'
      const declineNote = declined ? declineParts(d.decline_reason) : { by: '', why: '' }
      rows.push({
        id: d.id,
        kind: 'dispatch',
        at: d.authorised_at || d.committed_at || d.proposed_at,
        undecided,
        incidentId: incident.id,
        neighbourId: incident.neighbour_id,
        name: incident.name,
        address: incident.address + (incident.unit ? `, ${incident.unit}` : ''),
        priority: incident.priority,
        priorityLabel: incident.priority_label,
        resource: `${kindLabel(d.kind)} ${d.call_sign}`.trim(),
        assetKind: String(d.kind),
        agency,
        requestedBy: d.proposed_by || 'agent',
        verdict,
        decidedBy: d.authorised_by || declineNote.by || (verdict === 'auto' ? d.committed_by || 'agent' : ''),
        said: declineNote.why,
        basis: justification.get(d.id) || d.reason || '',
        after: afterwards(d),
      })
    }
  }

  // The ladder's own decision: telling a responder agency about somebody. Prepared by BuddyE,
  // released only by a named human — the same property as an agency dispatch, one rung up.
  for (const packet of packets) {
    const incident = incidents.find((i) => i.escalation_id === packet.escalation_id)
    rows.push({
      id: packet.id,
      kind: 'handoff',
      at: packet.released_at || packet.prepared_at,
      undecided: !packet.released,
      incidentId: incident?.id ?? null,
      neighbourId: packet.neighbour_id,
      name: incident?.name ?? packet.neighbour_id,
      address: incident?.address ?? '',
      priority: incident?.priority ?? null,
      priorityLabel: incident?.priority_label ?? '',
      resource: 'Responder handoff packet',
      assetKind: 'HANDOFF',
      agency: true,
      requestedBy: 'escalation ladder',
      verdict: packet.released ? 'released' : 'prepared',
      decidedBy: packet.released_by || '',
      said: packet.release_note || '',
      basis: packet.recommended_action || '',
      // The backend's own sentence for an unreleased packet, rendered as written.
      after: packet.released ? 'A named person read it out to the agency' : packet.status_note,
    })
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function cell(value: string | number | null | undefined): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The record as a file.
 *
 * Decisions, and the grounds they were taken on. No health record is copied across as a field —
 * there is no conditions column, no medication column, no access notes — but be clear-eyed about
 * `grounds`: it is the agent's justification, and a justification for spending an ambulance says
 * why *this person* needed one ("wheelchair and no car", "the concentrator alarmed twice"). That is
 * health information about a named individual, and it is in the export on purpose, because an audit
 * record that cannot answer "why did you spend that unit" is not a record. Treat the file as what it
 * is: a document about vulnerable people, exported by a named person who is accountable for it.
 */
export function decisionsCsv(rows: readonly DecisionRow[]): string {
  const head = [
    'when', 'person', 'address', 'priority', 'resource', 'needed_authorisation',
    'requested_by', 'grounds', 'decision', 'decided_by', 'they_said', 'afterwards', 'record_id',
  ]
  const body = rows.map((r) =>
    [
      r.at, r.name, r.address, r.priority ?? '', r.resource, r.agency ? 'yes' : 'no',
      r.requestedBy, r.basis, verdictWord(r.verdict), r.decidedBy, r.said, r.after, r.id,
    ].map(cell).join(','),
  )
  return [head.join(','), ...body].join('\n')
}

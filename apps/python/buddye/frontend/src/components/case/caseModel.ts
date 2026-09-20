/**
 * The arithmetic behind the catalogue and the case: ordering, merging, and the two vocabularies
 * that have to be reconciled before anything can be drawn.
 *
 * Nothing here invents a fact. Every sentence a screen shows comes from `lib/status.ts`,
 * `lib/operator.ts` or the backend's own wording; what this module decides is which of them is the
 * *most important* one and in what order the rows sit.
 */
import type { CallPhase, CallView, CheckOutcome, CheckResult, Escalation, HandoffPacket, IncidentRow, Risk, StreamState, TranscriptTurn } from '../../types'
import type { BadgeTone } from '../ui/Badge'
import type { PillTone } from '../Pill'
import type { BoardPerson } from '../../lib/board'
import { attentionRank } from '../../lib/board'
import { BAND_RANK, phaseIsLive } from '../../lib/status'
import { awaitingApproval, incidentIsOpen, isRolling } from '../../lib/operator'
import type { CaseCall, CaseEvent, CompletionConfidence } from './caseApi'

// ---------------------------------------------------------------------------
// Two tone scales, one screen
// ---------------------------------------------------------------------------

/**
 * `lib/status.ts` speaks `PillTone` (…, `grey`); `ui/Badge` speaks `BadgeTone` (…, `neutral`).
 * They are the same palette under different names and they do not unify in the type system, so the
 * translation lives in exactly one place rather than being re-typed at every call site.
 */
export function badgeTone(tone: PillTone): BadgeTone {
  return tone === 'grey' ? 'neutral' : tone
}

// ---------------------------------------------------------------------------
// Triage: the one reason that matters most
// ---------------------------------------------------------------------------

/**
 * The single sentence that best explains why **this** person is on the screen.
 *
 * The score is the engine's and is never recomputed here; what this picks is which of the reasons
 * behind it to print in a column one line high, and it does that by how much the sentence
 * distinguishes this house from the one below it.
 *
 *   * `base` and `ceiling` are administrative — "on the roster for a heat warning" and the score cap
 *     explaining itself — and are dropped outright.
 *   * `heat:temp`, `cold:temp` and `smoke:aqi` describe the *hazard*. They are true, they carry real
 *     weight, and they are word-for-word identical for all fourteen people; a catalogue that prints
 *     "114F is dangerous for anyone" nine times down the same column has stopped telling anybody
 *     anything. So they are the answer of last resort.
 *   * `amplifier:age` and `amplifier:lives_alone` are about the person but not about their exposure.
 *     They sit between the two: better than the temperature, worse than the swamp cooler that failed
 *     or the concentrator on wall power.
 *
 * Within a tier the engine's own ordering stands — `assess()` returns its factors heaviest-first —
 * so this reorders categories, never weights.
 */
const ADMIN_FACTORS = new Set(['base', 'ceiling'])
const HAZARD_WIDE_FACTORS = new Set(['heat:temp', 'heat:no_temp', 'cold:temp', 'smoke:aqi'])

function factorTier(key: string): number {
  if (HAZARD_WIDE_FACTORS.has(key)) return 2
  if (key.startsWith('amplifier:')) return 1
  return 0
}

export function topReason(risk: Risk | null | undefined): string {
  if (!risk) return ''
  const factors = (risk.factors ?? []).filter((f) => !ADMIN_FACTORS.has(f.key))
  for (const tier of [0, 1, 2]) {
    const hit = factors.find((f) => factorTier(f.key) === tier)
    if (hit) return hit.reason
  }
  return (risk.reasons ?? [])[0] ?? ''
}

// ---------------------------------------------------------------------------
// One person's call, from both sources at once
// ---------------------------------------------------------------------------

/**
 * A call as the case page reads it: the durable row from `/api/cases`, overlaid with whatever the
 * live stream knows that the last fetch could not.
 *
 * Both halves are needed and neither is sufficient. The API survives a reload and carries the
 * decision, the evidence and the reconcile flag; the stream carries the turns arriving one at a
 * time while somebody is actually on the phone, and it is the only source that exists at all for a
 * call started thirty seconds ago from this very page.
 */
export interface CaseCallView {
  id: string
  attempt: number
  provider: string
  phase: CallPhase
  /** Currently on a phone line: ringing, talking, or being read. */
  live: boolean
  status: string | null
  outcome: CheckOutcome | null
  reason: string
  concerns: string[]
  lastWords: string
  result: CheckResult | null
  turns: TranscriptTurn[]
  summary: string | null
  duration_s: number | null
  started_at: string | null
  completed_at: string | null
  /** CALL-E's own post-call judgment of the task. NOT the understanding layer's per-field quotes. */
  taskEvidence: string[]
  confidence: CompletionConfidence | null
  validationErrors: string[]
  reconciled: boolean
  failure: string | null
}

/** A stored call's status, as a phase. Only used when the stream has nothing fresher. */
function phaseOf(status: string): CallPhase {
  switch (status) {
    case 'NO_ANSWER':
      return 'no_answer'
    case 'FAILED':
    case 'UNKNOWN': // not "over and fine": the outcome could not be established, so never 'completed'
      return 'failed'
    case 'PENDING':
      return 'queued'
    case 'DIALING':
      return 'dialing'
    default:
      // COMPLETED and INVALID_RESULT both mean the phone call itself is over.
      return 'completed'
  }
}

function mergeCall(api: CaseCall | null, live: CallView | null): CaseCallView | null {
  if (!api && !live) return null
  const phase: CallPhase = live ? live.phase : phaseOf(String(api?.status ?? ''))
  const isLive = phaseIsLive(phase)
  // While the call is running the turns are whatever has landed on the stream so far; once it is
  // over the stored transcript is authoritative, because it is the one that survived reconcile.
  const stored = api?.transcript ?? []
  const turns = isLive ? live?.liveTurns ?? [] : stored.length ? stored : live?.transcript ?? live?.liveTurns ?? []
  const decision = live?.decision ?? null
  return {
    id: api?.id ?? live?.call_id ?? '',
    attempt: api?.attempt ?? 1,
    provider: api?.provider ?? live?.provider ?? '',
    phase,
    live: isLive,
    status: api?.status ?? live?.status ?? null,
    // The stream's decision is fresher than the last fetch mid-call; the stored row survives a
    // reload. Whichever exists wins in that order.
    outcome: decision?.outcome ?? api?.outcome ?? null,
    reason: decision?.reason ?? api?.outcome_reason ?? '',
    concerns: decision?.concerns ?? api?.concerns ?? [],
    lastWords: decision?.last_words ?? api?.structured_result?.alarming_quote ?? '',
    result: api?.structured_result ?? live?.structured_result ?? null,
    turns,
    summary: api?.summary ?? live?.summary ?? null,
    duration_s: api?.duration_s ?? live?.duration_s ?? null,
    started_at: api?.started_at ?? live?.started_at ?? null,
    completed_at: api?.completed_at ?? live?.completed_at ?? null,
    taskEvidence: api?.evidence ?? live?.evidence ?? [],
    confidence: api?.completion_confidence ?? null,
    validationErrors: api?.validation_errors ?? live?.validation_errors ?? [],
    reconciled: Boolean(api?.reconciled),
    failure: live?.failure_message ?? null,
  }
}

/**
 * Every call placed to **this person**, oldest first.
 *
 * The `callee` filter is not a detail. A neighbour's emergency contact is rung under the
 * neighbour's own id, so without it the case page would show the daughter's conversation as her
 * mother's, and a reassuring contact call would overwrite an alarming check-in.
 */
export function ownCalls(apiCalls: CaseCall[], stream: StreamState, neighbourId: string): CaseCallView[] {
  const live = new Map<string, CallView>()
  for (const id of stream.callOrder) {
    const view = stream.calls[id]
    if (view && view.neighbour_id === neighbourId && view.callee === 'neighbour') live.set(id, view)
  }
  const merged: CaseCallView[] = []
  for (const call of apiCalls) {
    if (call.callee !== 'neighbour') continue
    merged.push(mergeCall(call, live.get(call.id) ?? null)!)
    live.delete(call.id)
  }
  // Anything the stream has that the last fetch does not: a call started from this page seconds ago.
  for (const view of live.values()) merged.push(mergeCall(null, view)!)
  merged.sort((a, b) => String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')))
  return merged
}

/** The call placed to the person they nominated, if the ladder made one. Read, never confused. */
export function contactCalls(apiCalls: CaseCall[]): CaseCall[] {
  return apiCalls.filter((c) => c.callee === 'emergency_contact')
}

// ---------------------------------------------------------------------------
// The understanding layer's evidence
// ---------------------------------------------------------------------------

/**
 * The words that decided each field, keyed by field name.
 *
 * Two different things in this product are called "evidence" and only one of them is this. CALL-E
 * returns its own post-call judgment as `call.evidence` — sentences about whether the task got
 * done. The understanding layer (`reconcile_glm`) returns a *quote per field*, and that never
 * reaches `_call_out`: it survives only on the `reconcile.finished` event, at `meta.evidence`.
 * So it is read back out of the case's own timeline, joined on `call_id`.
 */
export function fieldEvidence(timeline: CaseEvent[], callId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ev of timeline) {
    if (ev.type !== 'reconcile.finished') continue
    if (String(ev.payload.call_id ?? '') !== callId) continue
    const meta = ev.payload.meta
    if (!meta || typeof meta !== 'object') continue
    const evidence = (meta as Record<string, unknown>).evidence
    if (!evidence || typeof evidence !== 'object') continue
    for (const [field, quote] of Object.entries(evidence as Record<string, unknown>)) {
      if (typeof quote === 'string' && quote.trim()) out[field] = quote.trim()
    }
  }
  return out
}

/** Which model read the call, and how long it took. Provenance for the panel above. */
export interface ReconcileMeta {
  reconciler: string
  model: string
  fields: string[]
  latency_ms: number | null
}

export function reconcileMeta(timeline: CaseEvent[], callId: string): ReconcileMeta | null {
  for (const ev of [...timeline].reverse()) {
    if (ev.type !== 'reconcile.finished') continue
    if (String(ev.payload.call_id ?? '') !== callId) continue
    const meta = (ev.payload.meta ?? {}) as Record<string, unknown>
    return {
      reconciler: String(meta.reconciler ?? ''),
      model: String(meta.model ?? ''),
      fields: Array.isArray(meta.fields) ? meta.fields.map(String) : [],
      latency_ms: typeof meta.latency_ms === 'number' ? meta.latency_ms : null,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The catalogue's order
// ---------------------------------------------------------------------------

export type SweepGroup = 'unreachable_high' | 'urgent' | 'unreachable' | 'needs_help' | 'calling' | 'waiting' | 'settled' | 'opted_out'

/**
 * Which bucket a person is in, and therefore how far up the list they sit.
 *
 * The order is who needs a human most, and the top of it is deliberate: an unanswered phone at a
 * critical-band house is worse than an alarming call that was actually answered, because there is
 * no voice on the record to weigh against it. `attentionRank` in `lib/board.ts` already encodes
 * that judgement and it is reused rather than restated.
 *
 * `opted_out` sits at the bottom and is never folded into "not called yet". Somebody who asked not
 * to be rung is not an oversight, and a list that treats them as one invites a coordinator to
 * correct it by ringing them.
 */
export const GROUP_ORDER: SweepGroup[] = [
  'unreachable_high',
  'urgent',
  'unreachable',
  'needs_help',
  'calling',
  'waiting',
  'settled',
  'opted_out',
]

const ATTENTION_GROUP: SweepGroup[] = ['unreachable_high', 'urgent', 'unreachable', 'needs_help']

export function groupOf(person: BoardPerson): SweepGroup {
  if (!person.n.check_in_consent) return 'opted_out'
  const rank = attentionRank(person)
  if (rank !== null) return ATTENTION_GROUP[rank]
  if (person.call && phaseIsLive(person.call.phase)) return 'calling'
  if (person.outcome === 'SAFE' || person.outcome === 'HELP_DECLINED') return 'settled'
  return 'waiting'
}

export const GROUP_LABEL: Record<SweepGroup, string> = {
  unreachable_high: 'No answer, high risk',
  urgent: 'Urgent',
  unreachable: 'No answer',
  needs_help: 'Needs help',
  calling: 'On the phone now',
  waiting: 'Not called yet',
  settled: 'Spoken to, alright',
  opted_out: 'Opted out of calls',
}

/** Worst first, and inside a bucket the highest-risk house first. Ties break on name, not on id. */
export function sweepOrder(board: BoardPerson[]): BoardPerson[] {
  const rank = (p: BoardPerson) => GROUP_ORDER.indexOf(groupOf(p))
  return [...board].sort((a, b) => {
    const ga = rank(a)
    const gb = rank(b)
    if (ga !== gb) return ga - gb
    const ba = BAND_RANK[a.n.risk?.band ?? 'routine'] ?? 0
    const bb = BAND_RANK[b.n.risk?.band ?? 'routine'] ?? 0
    if (ba !== bb) return bb - ba
    const sa = a.n.risk?.score ?? 0
    const sb = b.n.risk?.score ?? 0
    if (sa !== sb) return sb - sa
    return a.n.name.localeCompare(b.n.name)
  })
}

// ---------------------------------------------------------------------------
// What is waiting on somebody
// ---------------------------------------------------------------------------

export interface Waiting {
  text: string
  tone: PillTone
  /** True when a person, not the software, is the thing being waited on. */
  human: boolean
}

/**
 * The one sentence for "what is outstanding on this person", worst first.
 *
 * A prepared agency unit outranks everything else on the screen and says so in the words the rest
 * of the console uses: **request, not sent**. Nothing here can approve it; the sentence exists to
 * send somebody to the incident where a named human can.
 */
export function waitingOn(
  neighbourId: string,
  incidents: IncidentRow[],
  packets: HandoffPacket[],
  escalations: Escalation[],
): Waiting | null {
  const mine = incidents.filter((i) => i.neighbour_id === neighbourId)
  const open = mine.filter(incidentIsOpen)

  const unapproved = mine.flatMap((i) => i.dispatches.filter(awaitingApproval))
  if (unapproved.length) {
    return { text: 'Agency unit prepared — not sent, needs approval', tone: 'rejected', human: true }
  }
  const packet = packets.find((p) => p.neighbour_id === neighbourId && !p.released)
  if (packet) return { text: 'Responder packet prepared — not released', tone: 'rejected', human: true }

  const rolling = open.flatMap((i) => i.dispatches.filter(isRolling))
  if (rolling.length) {
    const one = rolling[0]
    return { text: `${one.call_sign} on the way`, tone: 'accent', human: false }
  }
  const onScene = open.find((i) => i.status === 'ON_SCENE')
  if (onScene) return { text: 'Somebody is at the address', tone: 'verified', human: false }
  if (open.length) return { text: 'Deployment case open — nothing sent', tone: 'partial', human: true }

  const escalation = escalations.find(
    (e) => e.neighbour_id === neighbourId && e.status !== 'RESOLVED' && e.status !== 'CANCELLED',
  )
  if (escalation) return { text: 'Escalation open', tone: 'partial', human: true }
  return null
}

// ---------------------------------------------------------------------------
// The agent log
// ---------------------------------------------------------------------------

/** What each kind of `OperatorAction` actually was, in the coordinator's words. */
const ACTION_LABEL: Record<string, string> = {
  dispatch_proposal: 'Chose which unit to send',
  situation_brief: 'Wrote the situation brief',
  ics_document: 'Drafted an ICS form',
  correspondence: 'Drafted a message for a person to send',
  triage: 'Scored the risk',
}

export function actionLabel(kind: string): string {
  return ACTION_LABEL[kind] ?? kind.replace(/_/g, ' ')
}

/**
 * The event types worth showing beside the agent's decisions.
 *
 * The timeline holds every event the orchestrator published about this person, and during a
 * deployment most of those are `asset.moved` — dozens of position updates a minute. Those belong on
 * the map, not in a log somebody reads. What is left is the story of the evening: rung, answered,
 * decided, escalated, a case opened, a unit proposed.
 */
export const LOGGED_EVENTS = new Set([
  'case.call_requested',
  'call.started',
  'call.skipped',
  'call.completed',
  'call.failed',
  'neighbour.skipped',
  'reconcile.finished',
  'check.decided',
  'escalation.opened',
  'escalation.rung',
  'escalation.exists',
  'escalation.notified',
  'handoff.prepared',
  'handoff.released',
  'incident.opened',
  'dispatch.proposed',
  'dispatch.committed',
  'dispatch.awaiting_authorisation',
  'dispatch.authorised',
  'dispatch.declined',
  'dispatch.en_route',
  'dispatch.arrived',
])

const EVENT_LABEL: Record<string, string> = {
  'case.call_requested': 'A coordinator asked for a call',
  'call.started': 'Dialled',
  'call.skipped': 'Not dialled',
  'call.completed': 'Call ended',
  'call.failed': 'Call failed',
  'neighbour.skipped': 'Not called',
  'reconcile.finished': 'The understanding layer read the transcript',
  'check.decided': 'Outcome decided',
  'escalation.opened': 'Escalation opened',
  'escalation.rung': 'Escalation moved a rung',
  'escalation.exists': 'Escalation already open',
  'escalation.notified': 'Block captain notified',
  'handoff.prepared': 'Responder packet prepared — not released',
  'handoff.released': 'Responder packet released by a person',
  'incident.opened': 'Deployment case opened',
  'dispatch.proposed': 'A unit was proposed',
  'dispatch.committed': 'A community unit was committed',
  'dispatch.awaiting_authorisation': 'Agency unit prepared — waiting on a named human',
  'dispatch.authorised': 'Approved by a named human',
  'dispatch.declined': 'Declined by a named human',
  'dispatch.en_route': 'On the road',
  'dispatch.arrived': 'At the address',
}

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? type.replace(/[._]/g, ' ')
}

/** One line of detail under an event, taken from its payload. Never invented, often empty. */
export function eventDetail(ev: CaseEvent): string {
  const p = ev.payload ?? {}
  const first = (...keys: string[]): string => {
    for (const key of keys) {
      const value = p[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }
  if (ev.type === 'call.completed') {
    const status = first('status')
    const summary = first('summary')
    return summary || status
  }
  return first('reason', 'summary', 'note', 'result', 'justification', 'recommended_action', 'message')
}

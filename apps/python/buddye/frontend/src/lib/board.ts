/**
 * Turning four sources into one row per person.
 *
 * The board is fed by REST (the roster, the ladder, the packets — authoritative, and it knows about
 * sweeps that finished before this tab was opened) and by SSE (what is happening on a phone line
 * right now). This module merges them, and it is the only place that decides which wins.
 *
 * Two rules are load-bearing:
 *
 *  1. **`callee` filtering.** A neighbour can have a call to *them* and a call to their emergency
 *     contact in the same sweep, both stamped with their `neighbour_id`. `theirOwnCall` filters to
 *     `callee === 'neighbour'`; without it Elena's call would overwrite Rosa's outcome and the
 *     transcript view would show the wrong conversation.
 *  2. **An outcome and being unaccounted for are different findings.** UNREACHABLE means we rang and
 *     nobody picked up. Unaccounted means nobody rang at all. Neither is ever folded into the other,
 *     and a person in neither bucket is a bug the console should make visible rather than hide.
 */
import type {
  CallView,
  CheckDecidedPayload,
  CheckOutcome,
  Escalation,
  HandoffPacket,
  Neighbour,
  StreamState,
  UnaccountedRow,
} from '../types'
import { BAND_RANK, OUTCOME_RANK, bandAtLeast } from './status'

export interface BoardPerson {
  n: Neighbour
  outcome: CheckOutcome | null
  /** Why the outcome is what it is, in the words `decide()` wrote. */
  reason: string
  /** What they said, close to their own words. Empty when nobody spoke to them. */
  concerns: string[]
  lastWords: string
  /** Their own check-in call — never the contact's. */
  call: CallView | null
  /** The contact call placed about them, if the ladder made one. */
  contactCall: CallView | null
  escalation: Escalation | null
  packet: HandoffPacket | null
  /** Not dialled, and why (consent, allowlist, budget). Null when a call was placed. */
  notDialledReason: string | null
}

function callsFor(stream: StreamState, neighbourId: string): CallView[] {
  return stream.callOrder.map((id) => stream.calls[id]).filter((c): c is CallView => !!c && c.neighbour_id === neighbourId)
}

export function buildBoard(
  roster: Neighbour[],
  stream: StreamState,
  escalations: Escalation[],
  packets: HandoffPacket[],
): BoardPerson[] {
  const escByNeighbour = new Map<string, Escalation>()
  for (const e of escalations) {
    const prev = escByNeighbour.get(e.neighbour_id)
    // Latest wins; a second sweep of the same block opens a fresh ladder for the same person.
    if (!prev || e.created_at >= prev.created_at) escByNeighbour.set(e.neighbour_id, e)
  }
  const packetByNeighbour = new Map<string, HandoffPacket>()
  for (const p of packets) {
    const prev = packetByNeighbour.get(p.neighbour_id)
    if (!prev || p.prepared_at >= prev.prepared_at) packetByNeighbour.set(p.neighbour_id, p)
  }

  return roster.map((n) => {
    const mine = callsFor(stream, n.id)
    const call = [...mine].reverse().find((c) => c.callee === 'neighbour') ?? null
    const contactCall = [...mine].reverse().find((c) => c.callee === 'emergency_contact') ?? null
    const decision: CheckDecidedPayload | null = stream.decisions[n.id] ?? call?.decision ?? null
    // The stream is fresher than the last REST fetch mid-sweep; the REST row survives a reload.
    const outcome = decision?.outcome ?? n.outcome ?? null
    const skipped = stream.skipped[n.id] ?? null
    return {
      n,
      outcome,
      reason: decision?.reason ?? n.outcome_reason ?? '',
      concerns: decision?.concerns ?? call?.structured_result?.concerns ?? [],
      lastWords: decision?.last_words ?? call?.structured_result?.alarming_quote ?? '',
      call,
      contactCall,
      escalation: escByNeighbour.get(n.id) ?? null,
      packet: packetByNeighbour.get(n.id) ?? null,
      notDialledReason: outcome ? null : skipped ?? (n.check_in_consent ? null : n.risk?.skip_reason || 'never opted in'),
    }
  })
}

/**
 * Does this person want a human tonight?
 *
 * UNREACHABLE at a high band is first because it is the case with nobody's voice attached: an
 * unanswered phone at a house with an oxygen concentrator in it is the most alarming thing on the
 * board precisely because there is no reassurance to weigh against it.
 */
export function attentionRank(p: BoardPerson): number | null {
  const band = p.n.risk?.band
  if (p.outcome === 'UNREACHABLE' && bandAtLeast(band, 'high')) return 0
  if (p.outcome === 'URGENT') return 1
  if (p.outcome === 'UNREACHABLE') return 2
  if (p.outcome === 'NEEDS_HELP') return 3
  return null
}

export function needsYouNow(board: BoardPerson[]): BoardPerson[] {
  return board
    .filter((p) => attentionRank(p) !== null)
    .sort((a, b) => {
      const ra = attentionRank(a) ?? 99
      const rb = attentionRank(b) ?? 99
      if (ra !== rb) return ra - rb
      const ba = BAND_RANK[a.n.risk?.band ?? 'routine'] ?? 0
      const bb = BAND_RANK[b.n.risk?.band ?? 'routine'] ?? 0
      if (ba !== bb) return bb - ba
      return (b.n.risk?.score ?? 0) - (a.n.risk?.score ?? 0)
    })
}

export function settled(board: BoardPerson[]): BoardPerson[] {
  return board
    .filter((p) => p.outcome === 'SAFE' || p.outcome === 'HELP_DECLINED')
    .sort((a, b) => a.n.name.localeCompare(b.n.name))
}

/** Everyone with an outcome or a call in flight, worst-first, for the full roster view. */
export function rosterOrder(board: BoardPerson[]): BoardPerson[] {
  return [...board].sort((a, b) => {
    const oa = a.outcome ? OUTCOME_RANK[a.outcome] : 90
    const ob = b.outcome ? OUTCOME_RANK[b.outcome] : 90
    if (oa !== ob) return oa - ob
    return (b.n.risk?.score ?? 0) - (a.n.risk?.score ?? 0)
  })
}

/**
 * Everyone nobody has accounted for.
 *
 * The sweep publishes this as its last event and it is authoritative once it arrives — it is the
 * only source that can tell "the sweep ended before reaching them" from "still to be called". Until
 * then the console derives the same list from the roster, so that a captain watching a sweep in
 * flight can already see who has not been reached.
 */
export function unaccountedFor(board: BoardPerson[], stream: StreamState): UnaccountedRow[] {
  if (stream.unaccounted) return stream.unaccounted
  return board
    .filter((p) => !p.outcome)
    .map((p) => ({
      neighbour_id: p.n.id,
      name: p.n.name,
      kind: !p.n.check_in_consent ? 'no_consent' : p.notDialledReason ? 'not_dialled' : 'still_running',
      reason: p.notDialledReason ?? 'still to be called',
    }))
    // Mid-sweep, "still to be called" is the queue, not a finding: listing eleven people under
    // "nobody has accounted for these people" thirty seconds into a sweep is alarm with no
    // information in it, and it would put whoever is on the phone right now on the missing list.
    // Only the people who will never be rung appear until the sweep publishes its own final list.
    .filter((r) => r.kind !== 'still_running')
}

/** Packets a named human has not released. In a healthy demo this is every packet there is. */
export function pendingPackets(packets: HandoffPacket[]): HandoffPacket[] {
  return packets.filter((p) => !p.released).sort((a, b) => b.prepared_at.localeCompare(a.prepared_at))
}

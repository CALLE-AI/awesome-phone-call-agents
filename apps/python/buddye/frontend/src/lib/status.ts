/**
 * How BuddyE's states are shown: tone, wording, and the order they are worked in.
 *
 * The captain reads this board on a phone in the evening. Every label here is written for her, not
 * for the schema: `UNREACHABLE` is "No answer", `HELP_DECLINED` is "Offered help, said no thanks",
 * and a risk band is never rendered as its number. `bandLabel` deliberately has no numeric variant.
 */
import type { PillTone } from '../components/Pill'
import type { CallPhase, CheckOutcome, EscalationLevel, EscalationStatus, RiskBand } from '../types'

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * Worked order, worst first — the order the console stacks its sections in.
 * UNREACHABLE leads because nobody answering a phone is the finding that most often needs a person
 * to physically go and look, and it is the one a backfill-shaped product would have skipped past.
 */
export const OUTCOME_ORDER: CheckOutcome[] = ['UNREACHABLE', 'URGENT', 'NEEDS_HELP', 'HELP_DECLINED', 'SAFE']

export const OUTCOME_RANK: Record<CheckOutcome, number> = {
  UNREACHABLE: 0,
  URGENT: 1,
  NEEDS_HELP: 2,
  HELP_DECLINED: 3,
  SAFE: 4,
}

const OUTCOME_META: Record<CheckOutcome, { tone: PillTone; label: string; blurb: string }> = {
  UNREACHABLE: { tone: 'rejected', label: 'No answer', blurb: 'We rang and nobody picked up.' },
  URGENT: { tone: 'rejected', label: 'Urgent', blurb: 'We spoke to them and something is wrong right now.' },
  NEEDS_HELP: { tone: 'partial', label: 'Needs help', blurb: 'They accepted something we offered.' },
  HELP_DECLINED: { tone: 'grey', label: 'Said no thanks', blurb: 'They need something and turned the offer down.' },
  SAFE: { tone: 'verified', label: 'Safe', blurb: 'We spoke to them and they are alright.' },
}

export function outcomeLabel(outcome: CheckOutcome | string | null | undefined): string {
  if (!outcome) return 'Not called yet'
  return OUTCOME_META[outcome as CheckOutcome]?.label ?? String(outcome)
}

export function outcomeTone(outcome: CheckOutcome | string | null | undefined): PillTone {
  if (!outcome) return 'grey'
  return OUTCOME_META[outcome as CheckOutcome]?.tone ?? 'grey'
}

export function outcomeBlurb(outcome: CheckOutcome | string | null | undefined): string {
  if (!outcome) return ''
  return OUTCOME_META[outcome as CheckOutcome]?.blurb ?? ''
}

/** Does this outcome want the captain's attention tonight? */
export function needsAttention(outcome: CheckOutcome | string | null | undefined): boolean {
  return outcome === 'UNREACHABLE' || outcome === 'URGENT' || outcome === 'NEEDS_HELP'
}

// ---------------------------------------------------------------------------
// Risk bands
// ---------------------------------------------------------------------------
export const BAND_RANK: Record<RiskBand, number> = { critical: 3, high: 2, elevated: 1, routine: 0 }

const BAND_META: Record<RiskBand, { tone: PillTone; label: string }> = {
  critical: { tone: 'rejected', label: 'Critical risk' },
  high: { tone: 'partial', label: 'High risk' },
  elevated: { tone: 'accent', label: 'Elevated risk' },
  routine: { tone: 'grey', label: 'Routine' },
}

export function bandLabel(band: RiskBand | string | null | undefined): string {
  if (!band) return 'Not scored'
  return BAND_META[band as RiskBand]?.label ?? String(band)
}

export function bandTone(band: RiskBand | string | null | undefined): PillTone {
  if (!band) return 'grey'
  return BAND_META[band as RiskBand]?.tone ?? 'grey'
}

export function bandAtLeast(band: RiskBand | string | null | undefined, min: RiskBand): boolean {
  if (!band) return false
  const rank = BAND_RANK[band as RiskBand]
  return rank === undefined ? false : rank >= BAND_RANK[min]
}

// ---------------------------------------------------------------------------
// Live call phases
// ---------------------------------------------------------------------------
const PHASE_META: Record<CallPhase, { tone: PillTone; label: string }> = {
  queued: { tone: 'grey', label: 'Queued' },
  dialing: { tone: 'accent', label: 'Ringing' },
  in_progress: { tone: 'accent', label: 'On the phone' },
  evaluating: { tone: 'accent', label: 'Reading the call' },
  completed: { tone: 'verified', label: 'Call finished' },
  no_answer: { tone: 'rejected', label: 'No answer' },
  failed: { tone: 'rejected', label: 'Call failed' },
  skipped: { tone: 'grey', label: 'Not dialled' },
}

export function phaseLabel(phase: CallPhase): string {
  return PHASE_META[phase]?.label ?? phase
}

export function phaseTone(phase: CallPhase): PillTone {
  return PHASE_META[phase]?.tone ?? 'grey'
}

export function phaseIsLive(phase: CallPhase): boolean {
  return phase === 'queued' || phase === 'dialing' || phase === 'in_progress' || phase === 'evaluating'
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------
const SWEEP_META: Record<string, { tone: PillTone; label: string }> = {
  CREATED: { tone: 'accent', label: 'Starting' },
  TRIAGING: { tone: 'accent', label: 'Working out who is in danger' },
  CALLING: { tone: 'accent', label: 'Calling the block' },
  ESCALATING: { tone: 'partial', label: 'Escalating' },
  AWAITING_HUMAN: { tone: 'partial', label: 'Waiting on you' },
  COMPLETE: { tone: 'verified', label: 'Finished' },
  BUDGET_EXHAUSTED: { tone: 'rejected', label: 'Ran out of calls' },
  FAILED: { tone: 'rejected', label: 'Sweep failed' },
}

export function sweepLabel(state: string | null | undefined): string {
  if (!state) return 'Not started'
  return SWEEP_META[state]?.label ?? state
}

export function sweepTone(state: string | null | undefined): PillTone {
  if (!state) return 'grey'
  return SWEEP_META[state]?.tone ?? 'grey'
}

export function sweepIsRunning(state: string | null | undefined): boolean {
  return !!state && !['COMPLETE', 'BUDGET_EXHAUSTED', 'FAILED'].includes(state)
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------
export const LADDER: EscalationLevel[] = ['EMERGENCY_CONTACT', 'BLOCK_CAPTAIN', 'RESPONDER']

/**
 * What each rung is, and — the part that matters — who does the acting on it.
 *
 * `who` is rendered next to every rung. BuddyE calls an emergency contact and notifies the block
 * captain. It does not call a responder, ever: it writes the packet and stops. Wording that leaves
 * that ambiguous is the failure this product is built to avoid.
 */
export const LADDER_META: Record<EscalationLevel, { label: string; who: string }> = {
  EMERGENCY_CONTACT: { label: 'Person they nominated', who: 'BuddyE calls them' },
  BLOCK_CAPTAIN: { label: 'Block captain', who: 'BuddyE puts it on your board' },
  RESPONDER: { label: 'Emergency responder', who: 'BuddyE prepares a packet — only you can release it' },
}

const RUNG_ACTION_LABEL: Record<string, string> = {
  entered: 'Opened here',
  called: 'Called',
  notified: 'Notified',
  skipped: 'Skipped',
  prepared: 'Packet prepared',
  released: 'Released by a person',
}

export function rungActionLabel(action: string): string {
  return RUNG_ACTION_LABEL[action] ?? action
}

const ESCALATION_STATUS_META: Record<EscalationStatus, { tone: PillTone; label: string }> = {
  OPEN: { tone: 'rejected', label: 'Open' },
  CONTACT_REACHED: { tone: 'partial', label: 'Someone is going round' },
  AWAITING_AUTHORISATION: { tone: 'rejected', label: 'Waiting on your decision' },
  RELEASED: { tone: 'partial', label: 'Released to a responder' },
  RESOLVED: { tone: 'verified', label: 'Resolved' },
  CANCELLED: { tone: 'grey', label: 'Cancelled' },
}

export function escalationStatusLabel(status: EscalationStatus | string): string {
  return ESCALATION_STATUS_META[status as EscalationStatus]?.label ?? String(status)
}

export function escalationStatusTone(status: EscalationStatus | string): PillTone {
  return ESCALATION_STATUS_META[status as EscalationStatus]?.tone ?? 'grey'
}

// ---------------------------------------------------------------------------
// Unaccounted
// ---------------------------------------------------------------------------
const UNACCOUNTED_META: Record<string, string> = {
  no_consent: 'Never opted in',
  not_dialled: 'Never dialled',
  still_running: 'Still to be called',
}

export function unaccountedLabel(kind: string): string {
  return UNACCOUNTED_META[kind] ?? kind.replace(/_/g, ' ')
}

// ---------------------------------------------------------------------------
// Extraction answers
// ---------------------------------------------------------------------------
/** "too_hot" -> "Dangerously hot indoors". The captain reads a sentence, not a field name. */
const CHECK_LABEL: Record<string, { yes: string; no: string }> = {
  too_hot: { yes: 'Dangerously hot indoors', no: 'House is comfortable' },
  too_cold: { yes: 'Dangerously cold indoors', no: 'House is warm enough' },
  has_power: { yes: 'Has power', no: 'No power' },
  has_water: { yes: 'Has drinking water', no: 'No drinking water' },
  has_food: { yes: 'Has food for today', no: 'No food for today' },
  has_medication: { yes: 'Has their medicine', no: 'Out of medicine' },
  equipment_working: { yes: 'Equipment running', no: 'Equipment has stopped' },
  can_evacuate: { yes: 'Could leave if they had to', no: 'Cannot get out on their own' },
  someone_with_them: { yes: 'Someone is with them', no: 'On their own' },
}

/** A check answer as a sentence and a tone. `unknown` returns null: it never came up, so say nothing. */
export function checkSentence(field: string, value: string): { text: string; good: boolean } | null {
  const v = String(value ?? '').toLowerCase()
  if (v !== 'yes' && v !== 'no') return null
  // A "no" to too_hot / too_cold carries no information worth a chip, and during a heat warning
  // "House is warm enough" sitting next to "Dangerously hot indoors" reads like a contradiction.
  // Only the alarming side of those two is shown.
  if (field.startsWith('too_') && v === 'no') return null
  const meta = CHECK_LABEL[field]
  const noun = field.replace(/^has_/, '').replace(/_/g, ' ')
  if (!meta) return { text: v === 'yes' ? noun : `no ${noun}`, good: v === 'yes' }
  // "too_hot: yes" is bad news; "has_water: yes" is good news. The label pair carries which is which.
  const bad = field.startsWith('too_')
  const good = bad ? v === 'no' : v === 'yes'
  return { text: v === 'yes' ? meta.yes : meta.no, good }
}

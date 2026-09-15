/**
 * Wire types for the BuddyE console.
 *
 * These mirror `app/api/schemas.py` and the event payloads `app/orchestrator/runner.py` publishes.
 * Two conventions carried over from the backend and worth stating here, because the UI depends on
 * both:
 *
 *   * A neighbour has an `outcome` OR they are `unaccounted` — never both, never neither. UNREACHABLE
 *     is an outcome (we rang, nobody picked up). `Unaccounted` means nobody rang them at all.
 *   * Every call carries `callee`. A single neighbour can have a call to *them* and a call to their
 *     emergency contact in the same sweep, both stamped with their `neighbour_id`. Anything that
 *     asks "what happened to Rosa" must filter `callee === 'neighbour'`, or Elena's call silently
 *     overwrites her mother's outcome and transcript.
 */

// ---------------------------------------------------------------------------
// Enumerations (string unions rather than enums: they arrive as strings)
// ---------------------------------------------------------------------------
export type HazardStatus = 'OPEN' | 'SWEEPING' | 'CLOSED'

export type SweepState =
  | 'CREATED'
  | 'TRIAGING'
  | 'CALLING'
  | 'ESCALATING'
  | 'AWAITING_HUMAN'
  | 'COMPLETE'
  | 'BUDGET_EXHAUSTED'
  | 'FAILED'

export type CheckOutcome = 'SAFE' | 'HELP_DECLINED' | 'NEEDS_HELP' | 'URGENT' | 'UNREACHABLE'

export type RiskBand = 'routine' | 'elevated' | 'high' | 'critical'

export type EscalationLevel = 'EMERGENCY_CONTACT' | 'BLOCK_CAPTAIN' | 'RESPONDER'

export type EscalationStatus =
  | 'OPEN'
  | 'CONTACT_REACHED'
  | 'AWAITING_AUTHORISATION'
  | 'RELEASED'
  | 'RESOLVED'
  | 'CANCELLED'

export type Callee = 'neighbour' | 'emergency_contact'

/** UNKNOWN: we cannot tell whether the phone rang (an ambiguous create or a poll deadline). The sweep stops on it. */
export type CallStatus = 'PENDING' | 'DIALING' | 'COMPLETED' | 'NO_ANSWER' | 'FAILED' | 'INVALID_RESULT' | 'UNKNOWN'

// ---------------------------------------------------------------------------
// Hazard
// ---------------------------------------------------------------------------
export interface HazardProfile {
  label: string
  describe: string
  speakable_facts: string[]
  cuts_power: boolean
  may_evacuate: boolean
  swamp_cooler_compromised: boolean
  severity_weight?: number
  [k: string]: unknown
}

export interface HelpOffer {
  key: string
  label: string
  text: string
}

export interface Hazard {
  id: string
  kind: string
  headline: string
  area: string
  severity: string
  status: HazardStatus
  starts_at: string
  ends_at: string
  facts: Record<string, unknown>
  help_offered: HelpOffer[]
  source: string
  declared_by: string
  created_at: string
  closed_at: string | null
  active_sweep_id: string | null
  sweeps: number
  profile: HazardProfile
}

export interface SweepAccepted {
  sweep_id: string
  hazard_id: string
  state: SweepState
  created: boolean
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------
export interface RiskFactor {
  key: string
  points: number
  reason: string
}

/** `RiskAssessment.to_dict()`. `reasons` is the plain-English list; never show `score` on its own. */
export interface Risk {
  neighbour_id: string
  name: string
  hazard_id: string
  hazard_kind: string
  severity: string
  score: number
  band: RiskBand
  reasons: string[]
  factors: RiskFactor[]
  time_to_harm_h: number | null
  may_call: boolean
  skip_reason: string
  engine?: string
}

// ---------------------------------------------------------------------------
// Neighbour
// ---------------------------------------------------------------------------
export interface Neighbour {
  id: string
  name: string
  phone_masked: string
  address: string
  unit: string
  access_notes: string
  lat: number
  lon: number
  age_band: string
  lives_alone: boolean
  conditions: string[]
  power_dependent: boolean
  power_backup_hours: number
  cooling: string
  heating: string
  mobility: string
  has_transport: boolean
  preferred_language: string
  contact_name: string
  contact_relation: string
  has_contact_phone: boolean
  check_in_consent: boolean
  notes: string
  is_demo: boolean
  risk: Risk | null
  outcome: CheckOutcome | null
  outcome_reason: string | null
  last_call_at: string | null
}

export interface TranscriptTurn {
  speaker: string
  text: string
  offset_seconds?: number | null
}

/** The extraction CALL-E returns. Shapes come from `app/calls/contract.py`. */
export interface CheckResult {
  reached_intended_person?: string
  is_safe_now?: string
  needs_help_now?: string
  checks?: Record<string, string>
  equipment_hours_remaining?: string
  help_offers_stated?: string
  help_accepted?: string[]
  help_declined?: string[]
  concerns?: string[]
  alarming_quote?: string
  sounded_distressed?: string
  call_back_requested?: string
  call_back_time?: string
  notes?: string
  [k: string]: unknown
}

export interface NeighbourCall {
  id: string
  sweep_id: string
  callee: Callee
  attempt: number
  status: CallStatus | string
  outcome: CheckOutcome | null
  outcome_reason: string | null
  concerns: string[] | null
  structured_result: CheckResult | null
  transcript: TranscriptTurn[] | null
  summary: string | null
  duration_s: number | null
  started_at: string | null
  completed_at: string | null
}

export interface NeighbourDetail {
  neighbour: Neighbour
  calls: NeighbourCall[]
  escalations: {
    id: string
    outcome: string
    level: EscalationLevel
    status: EscalationStatus
    reason: string
    rungs: Rung[]
    resolved_by: string
    resolved_note: string
  }[]
  handoffs: {
    id: string
    escalation_id: string
    recommended_action: string
    released: boolean
    released_by: string
  }[]
}

// ---------------------------------------------------------------------------
// Escalation ladder
// ---------------------------------------------------------------------------
export interface Rung {
  level: EscalationLevel
  /** entered | called | notified | skipped | prepared | released */
  action: string
  result: string
  note: string
  call_id: string | null
  at: string
}

export interface Escalation {
  id: string
  sweep_id: string
  hazard_id: string
  neighbour_id: string
  name: string
  address: string
  outcome: CheckOutcome
  level: EscalationLevel
  status: EscalationStatus
  reason: string
  trigger_call_id: string | null
  rungs: Rung[]
  contact_name: string
  contact_relation: string
  resolved_by: string
  resolved_note: string
  created_at: string
  updated_at: string
  resolved_at: string | null
  handoffs: HandoffPacket[]
}

/**
 * A responder handoff. `released === false` is the safety property of the whole product: this
 * document has told nobody anything. `status_note` is the backend's own sentence for that state and
 * the UI renders it verbatim rather than inventing softer wording.
 */
export interface HandoffPacket {
  id: string
  escalation_id: string
  neighbour_id: string
  hazard_id: string
  recommended_action: string
  spoken_script: string
  last_words: string
  concerns: string[]
  last_contact_at: string | null
  prepared_at: string
  released: boolean
  released_at: string | null
  released_by: string
  release_note: string
  status_note: string
  /** Present only on GET /api/handoffs/{id}. */
  neighbour_snapshot?: Record<string, unknown>
  hazard_snapshot?: Record<string, unknown>
  attempts_summary?: { at?: string; callee?: string; status?: string; outcome?: string; note?: string; [k: string]: unknown }[]
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------
export interface UnaccountedRow {
  neighbour_id: string
  name: string
  /** no_consent | not_dialled | still_running */
  kind: string
  reason: string
}

export interface SweepSummary {
  sweep_id: string
  hazard_id: string
  state: SweepState
  is_active: boolean
  provider: string
  roster_size: number
  queued: number
  calls_made: number
  current_index: number
  outcomes: Record<string, CheckOutcome>
  outcome_counts: Record<string, number>
  unaccounted: UnaccountedRow[]
  escalations_open: number
  escalations: number
  handoffs_prepared: number
  handoffs_released: number
  error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  triage?: Record<string, Risk>
  call_order?: string[]
}

// ---------------------------------------------------------------------------
// Dashboard / status
// ---------------------------------------------------------------------------
export interface Dashboard {
  neighbours: number
  consenting: number
  hazards_open: number
  active_sweeps: number
  calls_made: number
  outcome_counts: Record<string, number>
  unaccounted: number
  escalations_open: number
  handoffs_prepared: number
  handoffs_released: number
  real_calls_used: number
  real_calls_budget: number
  provider: string
  block_captain: string
  area: string
}

export interface CalleStatus {
  ready: boolean
  live: boolean
  provider: string
  allowlist_count: number
  reconciler: string
  budget: { used: number; max: number; remaining: number }
  sdk?: { importable?: boolean; api_key_present?: boolean }
  cli?: { found?: boolean; authenticated?: boolean }
  mcp?: { reachable?: boolean }
  [k: string]: unknown
}

export interface ContractPreview {
  neighbour: { id: string; name: string; phone_masked: string; preferred_language: string; check_in_consent: boolean }
  contract: {
    task: string
    result_schema: Record<string, unknown>
    objectives: string[]
    hard_fields: string[]
    soft_fields: string[]
    must_return: string[]
    locale: string
    help_offers: HelpOffer[]
    offer_keys: string[]
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export interface AgentEvent {
  id: number
  hazard_id: string
  sweep_id: string | null
  neighbour_id: string | null
  type: string
  payload: Record<string, unknown> | null
  created_at: string
}

export interface CallStartedPayload {
  call_id: string
  neighbour_id: string
  name: string
  callee: Callee
  phone_masked: string
  provider: string
  idempotency_key: string
  locale: string
  risk: Risk | null
  contract?: {
    task: string
    result_schema: Record<string, unknown>
    objectives: string[]
    hard_fields: string[]
    soft_fields: string[]
    must_return: string[]
    help_offers: HelpOffer[]
  }
}

export interface CallCompletedPayload {
  call_id: string
  neighbour_id: string
  name: string
  callee: Callee
  status: CallStatus | string
  structured_result: CheckResult | null
  validation_errors: string[]
  summary: string | null
  duration_s: number | null
  transcript: TranscriptTurn[] | null
  failure_code: string | null
  failure_message: string | null
  task_completed: boolean | null
  completion_confidence: number | null
  evidence: string[] | null
}

/** `decide.Decision.to_dict()` plus the identifiers the runner stamps on. */
export interface CheckDecidedPayload {
  call_id: string
  neighbour_id: string
  name: string
  outcome: CheckOutcome
  reason: string
  concerns: string[]
  last_words: string
  findings: string[]
  checks: Record<string, string>
  unresolved: string[]
  help_accepted: string[]
  help_declined: string[]
  reached: boolean
  band: RiskBand
  priority: number
  escalates: boolean
}

export interface ProviderEventPayload {
  call_id: string
  neighbour_id: string
  callee: Callee
  message?: string | null
  status?: string | null
  provider_call_id?: string | null
  details?: Record<string, unknown> | null
}

export interface TriagedPayload {
  hazard: { kind: string; headline: string; severity: string }
  queued: number
  roster: number
  order: {
    neighbour_id: string
    name: string
    score: number
    band: RiskBand
    time_to_harm_h: number | null
    may_call: boolean
    skip_reason: string
    reasons: string[]
  }[]
}

// ---------------------------------------------------------------------------
// Live view models
// ---------------------------------------------------------------------------
export type CallPhase = 'queued' | 'dialing' | 'in_progress' | 'evaluating' | 'completed' | 'no_answer' | 'failed' | 'skipped'

export interface CallView {
  call_id: string
  neighbour_id: string
  /** Whose voice is on the line — the neighbour, or the person they nominated. */
  callee: Callee
  /** Who was dialled: the neighbour's name, or the contact's. */
  to_name: string
  phone_masked: string
  provider: string
  started_at: string
  phase: CallPhase
  providerStatus: string | null
  provider_call_id: string | null
  liveTurns: TranscriptTurn[]
  transcript: TranscriptTurn[] | null
  status: string | null
  structured_result: CheckResult | null
  validation_errors: string[]
  summary: string | null
  duration_s: number | null
  completed_at: string | null
  failure_code: string | null
  failure_message: string | null
  task_completed: boolean | null
  completion_confidence: number | null
  evidence: string[]
  reconcile: { fields: string[]; reconciler?: string; patched?: string[]; skipped?: string } | null
  decision: CheckDecidedPayload | null
  contract: CallStartedPayload['contract'] | null
  risk: Risk | null
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface StreamState {
  sweepId: string | null
  sweepState: SweepState | null
  sweepStateExtra: Record<string, unknown> | null
  provider: string | null
  hazardStatus: HazardStatus | null
  events: AgentEvent[]
  triage: Record<string, TriagedPayload['order'][number]>
  queued: number
  callIndex: number | null
  calls: Record<string, CallView>
  callOrder: string[]
  activeCallId: string | null
  /** neighbour_id -> the decision from their OWN check-in call. Contact calls never land here. */
  decisions: Record<string, CheckDecidedPayload>
  /** neighbour_id -> why no call was placed (consent, allowlist, budget). */
  skipped: Record<string, string>
  unaccounted: UnaccountedRow[] | null
  liveEscalations: Record<string, { escalation_id: string; neighbour_id: string; name: string; level: EscalationLevel; outcome: CheckOutcome }>
  livePackets: Record<string, { packet_id: string; neighbour_id: string; name: string; recommended_action: string }>
  providerError: { code?: string; message?: string; call_id?: string } | null
  sweepError: string | null
  /**
   * The operator layer, live.
   *
   * `assetPositions` is keyed by asset id and is the ONLY thing that moves a vehicle on the map:
   * it is written from `asset.moved` / `asset.arrived`, which the server emits from positions it
   * advanced on a wall clock. `routes` is keyed by dispatch id and holds the polyline the server
   * computed, captured from the dispatch payload (the movement events carry no route).
   */
  assetPositions: Record<string, AssetLive>
  routes: Record<string, LiveRoute>
  /** incident_id -> the sentence explaining why nothing could be sent. Cleared when one is. */
  noAssetFor: Record<string, string>
  lastEventId: number
  connection: ConnectionState
  error: string | null
}

// ---------------------------------------------------------------------------
// Operator layer: assets, incidents, dispatches, paperwork
//
// These mirror `app/api/assets.py`, `app/api/incidents.py` and `app/api/dispatch.py`. Two
// conventions carried over from the backend, both load-bearing in the UI:
//
//   * `requires_authorisation` is policy, not decoration. A dispatch carrying it stays PROPOSED —
//     a REQUEST — until a named human approves. Nothing is on its way, and no view may say it is.
//   * Every coordinate, distance, ETA and route on these types was computed server-side from real
//     Maryvale locations. The frontend draws them; it never invents one and never advances one.
// ---------------------------------------------------------------------------
export type AssetKind =
  | 'VOLUNTEER_DRIVER'
  | 'WELLNESS_VAN'
  | 'WATER_ICE_TRUCK'
  | 'COOLING_SHUTTLE'
  | 'POWER_CART'
  | 'NURSE_OUTREACH'
  | 'EMS_UNIT'
  | 'FIRE_UNIT'
  | 'POLICE_WELFARE'

export type AssetStatus = 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'ON_SCENE' | 'OUT_OF_SERVICE'

export type DispatchStatus = 'PROPOSED' | 'COMMITTED' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED'

export type IncidentStatus = 'OPEN' | 'TRIAGED' | 'DISPATCHED' | 'ON_SCENE' | 'RESOLVED' | 'CLOSED'

/** A [lat, lon] pair, exactly as `app.domain.geo` writes it. */
export type LatLon = [number, number]

export interface AssetDestination {
  incident_id: string
  address: string
  lat: number | null
  lon: number | null
  progress: number
  remaining_miles: number
  eta_minutes: number | null
  route: LatLon[]
  status: DispatchStatus | string
}

export interface Asset {
  id: string
  call_sign: string
  kind: AssetKind | string
  status: AssetStatus | string
  operator_name: string
  capabilities: string[]
  capacity: number
  served_this_shift: number
  spare_capacity: number
  speed_mph: number
  base_lat: number
  base_lon: number
  lat: number
  lon: number
  heading_deg: number
  notes: string
  requires_authorisation: boolean
  current_dispatch_id: string | null
  last_moved_at: string | null
  destination: AssetDestination | null
}

/** `dispatch_out()`. `status_note` is the backend's own sentence for a state and is rendered verbatim. */
export interface DispatchRow {
  id: string
  incident_id: string
  asset_id: string
  call_sign: string
  kind: AssetKind | string
  operator_name: string
  status: DispatchStatus | string
  reason: string
  proposed_by: string
  committed_by: string
  requires_authorisation: boolean
  authorised_by: string
  authorised_at: string | null
  decline_reason: string
  distance_miles: number
  eta_minutes: number
  route: LatLon[]
  progress: number
  proposed_at: string
  committed_at: string | null
  arrived_at: string | null
  completed_at: string | null
  address: string
  incident_lat: number | null
  incident_lon: number | null
  asset_lat: number | null
  asset_lon: number | null
  status_note: string
}

/** A row of `GET /api/dispatch/pending`: an agency unit an agent has prepared and NOT requested. */
export interface PendingDispatch extends DispatchRow {
  justification: string
  incident_priority: number | null
  incident_summary: string
  name: string
}

export interface IncidentNeed {
  capability: string
  reason: string
  life_safety: boolean
}

export interface NeedDetail {
  capabilities: string[]
  needs: IncidentNeed[]
  preferred: IncidentNeed[]
  notes: string[]
  agency_justified: boolean
  agency_reason: string
  outcome: string
  band: string
  priority: number
  priority_label: string
}

export interface IncidentRow {
  id: string
  hazard_id: string
  sweep_id: string
  neighbour_id: string
  escalation_id: string
  source_call_id: string
  name: string
  status: IncidentStatus | string
  priority: number
  priority_label: string
  outcome: CheckOutcome | string
  summary: string
  needs: string[]
  lat: number | null
  lon: number | null
  address: string
  unit: string
  access_notes: string
  power_dependent: boolean | null
  conditions: string[]
  mobility: string
  lives_alone: boolean | null
  opened_at: string
  resolved_at: string | null
  resolution: string
  dispatches: DispatchRow[]
  awaiting_authorisation: DispatchRow[]
}

/** One agent decision, with enough provenance to argue with a week later. */
export interface OperatorAction {
  id: string
  kind: string
  agent: string
  model: string
  rationale: string
  accepted: boolean
  accepted_by: string
  latency_ms: number | null
  error: string
  inputs: Record<string, unknown>
  output: Record<string, unknown>
  created_at: string
}

export interface IncidentDocument {
  id: string
  hazard_id: string
  incident_id: string
  form: string
  title: string
  body: string
  fields: Record<string, unknown>
  generated_by: string
  approved_by: string
  approved: boolean
  created_at: string
}

export interface CorrespondenceDraft {
  id: string
  hazard_id: string
  incident_id: string
  neighbour_id: string
  channel: string
  to_name: string
  to_ref: string
  subject: string
  body: string
  drafted_by: string
  approved_by: string
  approved: boolean
  sent_at: string | null
  /** The backend's own sentence. Nothing in BuddyE can set `sent_at`; this says so. */
  status_note: string
  created_at: string
}

export interface IncidentDetail extends IncidentRow {
  need_detail: NeedDetail
  situation: Record<string, unknown>
  risk_reasons: string[]
  documents: IncidentDocument[]
  correspondence: CorrespondenceDraft[]
  actions: OperatorAction[]
}

export interface EligibilityCandidate {
  asset_id: string
  call_sign: string
  kind: AssetKind | string
  matched: string[]
  preferred_matched: string[]
  unmet: string[]
  distance_miles: number
  eta_minutes: number
  spare_capacity: number
  capacity: number
  requires_authorisation: boolean
  fit: number
  reason: string
}

export interface EligibilityExclusion {
  asset_id: string
  call_sign: string
  kind: AssetKind | string
  /** status | committed | capacity | authorisation | capability | radius | speed | no_needs | no_location */
  code: string
  reason: string
}

export interface Eligibility {
  candidates: EligibilityCandidate[]
  excluded: EligibilityExclusion[]
  needs: NeedDetail
  radius_miles: number
  error: string
}

/**
 * Where one asset is *now*, as the server last advanced it.
 *
 * Seeded from `GET /api/assets` and thereafter moved only by `asset.moved` / `asset.arrived` events.
 * There is no interpolation and no animation: if the backend stops ticking, this stops changing,
 * which is the honest picture of a fleet whose telemetry has gone quiet.
 */
export interface AssetLive {
  lat: number
  lon: number
  heading_deg: number
  progress: number | null
  remaining_miles: number | null
  eta_minutes: number | null
  arrived: boolean
  dispatch_id: string | null
  incident_id: string | null
  /** Wall-clock ms when this position was received, so the UI can say how stale it is. */
  received_at: number
}

/** The route an en-route dispatch is actually following, as the server computed it. */
export interface LiveRoute {
  dispatch_id: string
  asset_id: string
  call_sign: string
  incident_id: string
  route: LatLon[]
  requires_authorisation: boolean
  status: DispatchStatus | string
}

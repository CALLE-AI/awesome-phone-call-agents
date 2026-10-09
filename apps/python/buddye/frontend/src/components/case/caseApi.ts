/**
 * The two calls the case page makes, and the exact shape of what comes back.
 *
 * These are declared here rather than in `src/types.ts` because they are not the wire types the
 * rest of the console uses. `app/api/cases.py::case_for` assembles its own view — `_call_out`,
 * `_escalation_out` and its handoff dict carry different keys from `NeighbourCall`, `Escalation`
 * and `HandoffPacket` — and typing this payload as those would be a lie tsc happens not to catch.
 *
 * `GET /api/cases/{hazard}/{neighbour}` deliberately returns the whole case in one response. The
 * backend's reason is worth repeating where the fetch lives: a case page assembled from six racing
 * requests shows a half-drawn picture of somebody's emergency.
 */
import { API_BASE } from '../../api'
import type {
  Callee,
  CheckOutcome,
  CheckResult,
  EscalationLevel,
  EscalationStatus,
  Hazard,
  IncidentDetail,
  Neighbour,
  Risk,
  TranscriptTurn,
} from '../../types'

// ---------------------------------------------------------------------------
// Wire shapes — mirrors app/api/cases.py::case_for
// ---------------------------------------------------------------------------

/** CALL-E's own post-call judgment of whether the task got done. Not the understanding layer. */
export interface CompletionConfidence {
  score?: number
  label?: string
}

/** `_call_out`. The transcript rides along because it is the evidence for everything else. */
export interface CaseCall {
  id: string
  sweep_id: string
  callee: Callee
  attempt: number
  provider: string
  provider_call_id: string | null
  status: string
  outcome: CheckOutcome | null
  outcome_reason: string | null
  concerns: string[]
  structured_result: CheckResult | null
  validation_errors: string[]
  transcript: TranscriptTurn[]
  summary: string | null
  task_completed: boolean | null
  completion_confidence: CompletionConfidence | null
  evidence: string[]
  risk_snapshot: Risk | null
  reconciled: boolean
  duration_s: number | null
  started_at: string | null
  completed_at: string | null
}

export interface CaseRung {
  level: EscalationLevel
  action: string
  result: string
  note: string
  call_id: string | null
  at: string
}

export interface CaseEscalation {
  id: string
  sweep_id: string
  outcome: string
  level: EscalationLevel | string
  status: EscalationStatus | string
  reason: string
  rungs: CaseRung[]
  trigger_call_id: string | null
  resolved_by: string
  resolved_note: string
  created_at: string
  resolved_at: string | null
}

/**
 * A responder packet. `released === false` means this document has told nobody anything, and
 * `status_note` is the backend's own sentence for that. Both are rendered verbatim.
 */
export interface CaseHandoff {
  id: string
  escalation_id: string
  recommended_action: string
  spoken_script: string
  last_words: string
  concerns: string[]
  released: boolean
  released_by: string
  prepared_at: string
  status_note: string
}

/**
 * One agent decision, with enough provenance to argue with a week later.
 *
 * Declared here rather than reused from `types.ts` for one field: `accepted` is genuinely
 * three-state. `null` means no human has reviewed this proposal yet, which is not the same as a
 * human having rejected it, and a boolean cannot hold that difference.
 */
export interface CaseAction {
  id: string
  kind: string
  agent: string
  model: string
  rationale: string
  accepted: boolean | null
  accepted_by: string
  latency_ms: number | null
  error: string
  inputs: Record<string, unknown>
  output: Record<string, unknown>
  created_at: string
}

/** One row of this person's own agent log: every event the orchestrator published about them. */
export interface CaseEvent {
  id: number
  type: string
  payload: Record<string, unknown>
  at: string
}

/** Whether the call button is live, and if not, the sentence that says why. */
export interface CanCall {
  allowed: boolean
  reason: string
  provider: string
  budget_remaining: number | null
}

export interface CasePayload {
  hazard: Hazard
  neighbour: Neighbour
  risk: Risk
  risk_reasons: string[]
  sweep: { id: string; state: string; is_active: boolean; provider: string } | null
  calls: CaseCall[]
  escalations: CaseEscalation[]
  handoffs: CaseHandoff[]
  incidents: IncidentDetail[]
  dispatches: string[]
  actions: CaseAction[]
  timeline: CaseEvent[]
  can_call: CanCall
}

/** `POST .../call` — accepted, not finished. The call itself plays out on the event stream. */
export interface LaunchAccepted {
  status: string
  hazard_id: string
  neighbour_id: string
  name: string
  provider: string
  watch: string
  note: string
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * An API failure carrying the backend's own sentence.
 *
 * This matters more here than anywhere else in the console: `start_case_call` answers 409 with the
 * reason a dial was refused — no consent on file, not allowlisted, the budget is spent, "a call to
 * Walter is already in progress". Showing "Conflict" instead would hide the only useful part.
 */
export class CaseApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, { headers: { Accept: 'application/json' }, ...init })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body?.detail === 'string' && body.detail) detail = body.detail
    } catch {
      /* a non-JSON error body: the status text is all there is */
    }
    throw new CaseApiError(res.status, detail)
  }
  return (await res.json()) as T
}


export function fetchCase(hazardId: string, neighbourId: string, signal?: AbortSignal): Promise<CasePayload> {
  return json<CasePayload>(`/api/cases/${encodeURIComponent(hazardId)}/${encodeURIComponent(neighbourId)}`, { signal })
}

/** The model-written situation brief. See `fetchBrief` for why it is fetched separately. */
export interface SituationBrief {
  headline: string
  brief: string
  next_step: string
  watch_for: string
  confidence: 'high' | 'medium' | 'low'
  source: 'model' | 'fallback'
  generated: boolean
}

export type BriefResponse =
  | { status: 'ready'; call_id: string; brief: SituationBrief }
  | { status: 'pending'; call_id: string }
  | { status: 'unavailable'; reason: string }

/**
 * Ask for the brief on this person's latest finished call.
 *
 * Separate from `fetchCase` on purpose. The brief is written by a model on a free tier that answers
 * in 20-100 s and sometimes not at all; folding it into the case payload would make the page that
 * shows the call results wait on it. Everything the call returned renders without this, so a
 * `pending` that never resolves costs the page nothing — it just never grows a summary.
 */
export function fetchBrief(hazardId: string, neighbourId: string, signal?: AbortSignal): Promise<BriefResponse> {
  return json<BriefResponse>(
    `/api/cases/${encodeURIComponent(hazardId)}/${encodeURIComponent(neighbourId)}/brief`,
    { signal },
  )
}

/**
 * Ring one person. Returns as soon as the dial is accepted — everything after that arrives on the
 * SSE connection the layout already holds, which is why this returns a receipt and not an outcome.
 */
export function launchCall(hazardId: string, neighbourId: string, launchedBy: string): Promise<LaunchAccepted> {
  return json<LaunchAccepted>(`/api/cases/${encodeURIComponent(hazardId)}/${encodeURIComponent(neighbourId)}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ launched_by: launchedBy }),
  })
}

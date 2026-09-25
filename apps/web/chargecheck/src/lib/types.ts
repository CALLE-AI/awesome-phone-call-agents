// Core domain types for ChargeCheck.
// These describe OUR application's model, not the CALL-E wire format.
// CALL-E's actual call lifecycle/status enum is: queued | in_progress | completed | failed | canceled
// (see docs.heycall-e.com/calls#call-status). We do not invent additional top-level states.

export type ConnectorType = "CCS2" | "CCS1" | "CHAdeMO" | "Type2" | "GB/T";

export interface Station {
  id: string;
  name: string;
  /** E.164 phone number. Must be a number you own or are authorized to call. */
  phone: string;
  location: string;
  address: string;
  connectors: ConnectorType[];
  /** Advertised only. Never treated as verified truth. */
  advertisedHours?: string;
  advertisedNotes?: string;
  /**
   * True only for stations reviewed and included specifically for live
   * calling (published 24/7 network support lines — see
   * src/lib/stations.ts). The fictional DEMO_STATIONS set is never
   * authorized for live calls, even if an operator selects it with demo
   * mode off — this is enforced server-side in
   * src/app/api/check/start/route.ts regardless of what the client sends.
   */
  liveCallAuthorized?: boolean;
}

export interface CheckRequest {
  from: string;
  to: string;
  connector: ConnectorType;
  stationIds: string[];
  /** When true, use the MockProvider instead of a real CALL-E call. */
  demoMode: boolean;
  /**
   * The caller's own CALL-E API key, required only when demoMode is false.
   * Never stored server-side — used for exactly the request it's sent with,
   * then discarded. This is what lets a public deployment need zero CALL-E
   * credentials of its own: each visitor pays for their own live calls.
   */
  apiKey?: string;
  /**
   * Required (must be exactly `true`) whenever demoMode is false. This is
   * the operator's explicit attestation that they are authorized to have
   * CALL-E place a disclosed AI call to the selected number(s). It is not
   * proof of authorization — CALL-E's own permission and disclosure
   * guidance still applies — but it is the minimum bar the
   * awesome-phone-call-agents community/demo policy asks for: a deliberate,
   * recorded confirmation rather than a call placed by default.
   */
  operatorAttestation?: boolean;
}

/**
 * Mirrors the fields we ask CALL-E to extract via `recipientResultSchema`.
 * Any field CALL-E could not confidently extract comes back as "unknown"
 * (schema-enforced) rather than being silently omitted or guessed.
 */
export interface StationCallResult {
  operational: "yes" | "no" | "unknown";
  available_chargers: number | null;
  total_chargers: number | null;
  requested_connector_available: "yes" | "no" | "unknown";
  queue_present: "yes" | "no" | "unknown";
  estimated_wait_minutes: number | null;
  price_per_kwh: string;
  payment_requirements: string;
  accessibility: string;
  notes: string;
  answered_by: "human" | "ivr" | "voicemail" | "unknown";
}

export type CallLifecycleStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";

export interface StationCheckState {
  stationId: string;
  callId: string | null;
  /** Our provider label, surfaced in the UI so nothing is misrepresented as a real call. */
  provider: "calle" | "mock";
  status: CallLifecycleStatus;
  /** True once CALL-E judged the task reached a clear end state. Independent of business outcome. */
  taskCompleted: boolean | null;
  completionConfidence: number | null;
  evidence: string[];
  /** null whenever CALL-E could not produce a schema-valid result from the evidence. */
  structuredResult: StationCallResult | null;
  /**
   * When this check reached a terminal state via a CALL-E-reported outcome
   * (or our own explicit, known rejection — bad key, unauthorized station,
   * invalid number). Named `reportedAt`, not `verifiedAt`: nothing here is
   * independently verified station truth, only what was reported back from
   * an AI-conducted phone call or our own validation.
   */
  reportedAt: string | null;
  error?: string;
  /**
   * True when `status: "failed"` reflects a genuinely ambiguous outcome —
   * e.g. a network error while creating or polling the call, where we
   * cannot tell whether CALL-E actually placed/continued the call or not —
   * rather than a definite, known rejection (bad key, unauthorized station,
   * invalid E.164 number). An uncertain outcome should be reconciled, not
   * silently treated as a confirmed non-event; see
   * docs/production-workflows.md and the ambiguous-outcomes reference in
   * the upstream repo for why this distinction matters.
   */
  outcomeUncertain?: boolean;
}

export interface RankedStation {
  station: Station;
  check: StationCheckState;
  score: number;
  /** Call-reported, not independently verified — see StationCheckState.reportedAt. */
  reported: boolean;
  headline: string;
}

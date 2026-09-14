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
  verifiedAt: string | null;
  error?: string;
}

export interface RankedStation {
  station: Station;
  check: StationCheckState;
  score: number;
  verified: boolean;
  headline: string;
}

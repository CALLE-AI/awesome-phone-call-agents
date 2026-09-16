/**
 * Core domain types for Openings.
 *
 * A "candidate" is a directory listing (a phone number + attribution) that may
 * or may not correspond to a reachable practice. The only way to find out is
 * to call it. A "verdict" is the locally-computed classification of a CALL-E
 * structured result. A "fact" is a verified, timestamped observation about a
 * practice that later calls can reuse.
 */

/** Where a phone number came from. Never synthesized; always attributed. */
export interface Provenance {
  kind: "nppes" | "paste" | "csv";
  /** NPPES record id, when the source is NPPES. */
  npi?: string;
  /** The person who pasted or imported the row. */
  source?: string;
  /** Free-form attribution shown to the user next to the number. */
  note?: string;
}

/** A single directory listing to verify. */
export interface Candidate {
  id: string;
  /** Display name from the directory. May be empty for pasted rows. */
  name: string;
  /** E.164 phone number to dial. */
  phoneE164: string;
  /** Raw display form of the number as it appeared in the directory. */
  phoneDisplay: string;
  /** City / ZIP / address line shown to the user, when known. */
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Specialty or taxonomy description, when known. */
  specialty?: string;
  provenance: Provenance;
  /** NPPES record update timestamp, when known. Stale data is a feature, not a bug. */
  sourceUpdatedAt?: string;
}

/**
 * The strict structured result CALL-E is asked to extract from a call.
 * All enum fields include `unknown`; the classifier treats unknown honestly.
 */
export interface CallStructuredResult {
  line_outcome:
    | "reached_staff"
    | "voicemail"
    | "ivr_dead_end"
    | "disconnected"
    | "wrong_entity"
    | "declined"
    | "unknown";
  accepts_plan: "yes" | "no" | "out_of_network_only" | "unknown";
  accepting_new_patients: "yes" | "no" | "waitlist_only" | "unknown";
  /** Soonest appointment as stated by the practice, or empty. */
  soonest_appointment_stated: string;
  /** Days until soonest appointment, or -1 when unknown/not stated. */
  wait_estimate_days: number;
  modality: "in_person" | "telehealth" | "both" | "unknown";
  /** A short verbatim quote from the call supporting the classification. */
  evidence_quote: string;
}

/**
 * Classification of one directory listing, computed locally, never in-prompt.
 *
 * - `unreachable` means no person was reached (voicemail, closed office, IVR
 *   dead end, or no usable outcome).
 * - `inconclusive` means a person answered but plan/availability were not
 *   confirmed before the call ended — retry, never a confident verdict.
 * - `error` means the call could not be placed at all (SDK/API failure).
 */
export type Verdict =
  | "open"
  | "waitlist"
  | "not_accepting"
  | "ghost"
  | "unreachable"
  | "inconclusive"
  | "declined"
  | "error"
  | "blocked";

export interface LineCallResult {
  candidateId: string;
  /** E.164 number dialed, when a call was attempted. Used for cooldown tracking. */
  phoneE164?: string;
  verdict: Verdict;
  /** Verbatim evidence quote, when available. */
  evidence: string;
  /** The raw structured result this verdict was computed from, when present. */
  raw: CallStructuredResult | null;
  /** CALL-E call task id, when the result came from a live run. */
  calleCallId?: string;
  /** CALL-E's own post-call summary, when available. */
  summary?: string;
  /** ISO timestamp when the call completed. */
  completedAt: string;
  /** Terminal CALL-E status, when available. */
  calleStatus?: string;
}

/** A verified fact about a practice, timestamped. Facts compound. */
export interface Fact {
  id: string;
  practiceId: string;
  phoneE164: string;
  factType: "accepts_plan" | "accepting_new_patients" | "line_dead" | "wrong_entity" | "wait";
  value: string;
  evidence: string;
  recordedAt: string;
  sourceCallId?: string;
}

/** Search parameters for a standing watch. */
export interface SearchSpec {
  /** Human-readable plan name, e.g. "Aetna PPO". */
  plan: string;
  /** Modal preference: in-person, telehealth, or either. */
  modality: "in_person" | "telehealth" | "either";
  /** ZIP / city used for framing candidates. */
  location: string;
  /** Free-form care need shown to the practice, e.g. "adult ADHD evaluation". */
  need: string;
  /** Specialty id from the catalog; selects the NPPES taxonomy filter. */
  specialty: string;
}

export interface Watch {
  id: string;
  spec: SearchSpec;
  candidates: Candidate[];
  /** Number of open practices to stop at. */
  targetOpen: number;
  /** Hard cap on calls placed per run. Gate-blocked candidates do not count. */
  maxCallsPerRun: number;
  status: "active" | "paused" | "completed" | "stopped";
  createdAt: string;
  updatedAt: string;
  /** Idempotency scope for this watch's call tasks. */
  idempotencyPrefix: string;
}

export interface WatchCallLog {
  watchId: string;
  runNumber: number;
  results: LineCallResult[];
  createdAt: string;
}

/** Aggregate statistics over a watch's results so far. */
export interface WatchStats {
  called: number;
  reached: number;
  open: number;
  waitlist: number;
  notAccepting: number;
  ghost: number;
  unreachable: number;
  inconclusive: number;
  declined: number;
  error: number;
  blocked: number;
}

/** Crisis-screening result. */
export interface CrisisCheck {
  isCrisis: boolean;
  /** When true, no search should be started. */
  reason?: string;
}

export const WATCH_STATUSES = ["active", "paused", "completed", "stopped"] as const;
export const VERDICTS = [
  "open",
  "waitlist",
  "not_accepting",
  "ghost",
  "unreachable",
  "inconclusive",
  "declined",
  "error",
  "blocked",
] as const;


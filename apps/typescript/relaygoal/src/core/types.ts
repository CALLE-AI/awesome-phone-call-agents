// Domain types for the verified-phone-outcome core.
// These mirror the shapes CALL-E's API returns (POST /v1/calls), so the real
// @call-e/calle SDK and the FakeCalle stub are interchangeable behind CalleLike.

export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export type Speaker = "bot" | "user" | "unknown";

export interface TranscriptTurn {
  offsetSeconds: number;
  speaker: Speaker;
  text: string;
}

export interface CompletionConfidence {
  /** 0..1 as reported by CALL-E. Used only as ONE input to a conservative
   *  verified/unverified decision — it is never surfaced to the user as a score. */
  score: number;
  label: string;
}

/** The relevant subset of CALL-E's CallTask result. */
export interface CalleCallResult {
  status: CallStatus;
  taskCompleted: boolean;
  completionConfidence: CompletionConfidence;
  /** Free-text evidence spans CALL-E attaches to the outcome. */
  evidence?: string[];
  summary?: string;
  /** Values extracted per the requested result_schema. */
  structuredResult?: Record<string, unknown>;
  transcriptTurns: TranscriptTurn[];
}

/** Minimal client surface the core depends on. The real SDK and FakeCalle both satisfy it. */
export interface CalleLike {
  calls: {
    createAndWait(input: CreateCallInput): Promise<CalleCallResult>;
  };
}

export interface CreateCallInput {
  task: string;
  /** E.164; the single recipient for the common case. */
  phone: string;
  resultSchema?: Record<string, unknown>;
  /** Stable key so create-call retries never place a duplicate call. */
  idempotencyKey?: string;
}

export type VerificationStatus = "verified" | "unverified";

export interface Quote {
  text: string;
  speaker: Speaker;
  offsetSeconds: number;
}

export interface VerifiedField {
  key: string;
  value: unknown;
  status: VerificationStatus;
  /** Exact transcript turns that support `value`. This is the PROOF shown to the
   *  user — not a confidence number. Empty when unverified. */
  quotes: Quote[];
  /** Present only when unverified: why we would not vouch for this answer. */
  reason?: string;
}

export type OverallStatus = "verified" | "partial" | "unverified";

export interface VerifiedOutcome {
  overall: OverallStatus;
  fields: VerifiedField[];
  callStatus: CallStatus;
  /** True when the office could not be reached (no-answer / failed / canceled). */
  unreachable: boolean;
  summary: string;
  transcript: TranscriptTurn[];
  /** The honest, user-facing next step whenever we are not fully verified. */
  advice?: string;
}

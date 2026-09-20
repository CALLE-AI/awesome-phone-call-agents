import type { BusinessOutcome, CanonicalCallPayload } from "../runtime/types.js";

export type CalleCreateResult = {
  call_id: string;
  status: string;
  reused: boolean;
};

export type CallePollResult = {
  call_id: string;
  status: "queued" | "ringing" | "in_progress" | "completed" | "failed";
  provider_state: "accepted" | "ringing" | "completed" | "failed" | "unknown";
  business_outcome: BusinessOutcome | null;
  transcript: Array<{ speaker: "bot" | "user"; text: string }>;
  structured: Record<string, unknown> | null;
  confirmation_question_asked: boolean;
  answer_after_question: boolean;
  slot_matches_offered: boolean;
  schema_valid: boolean;
  reliable_transcript: boolean;
  transcript_result_conflict: boolean;
};

export interface CalleAdapter {
  readonly mode: "mock" | "live";
  /** Only a proven hard guarantee permits retrying a lost create response. */
  readonly idempotency_guarantee?: "hard" | "unverified";
  createCall(args: {
    idempotency_key: string;
    payload: CanonicalCallPayload;
  }): Promise<CalleCreateResult>;
  getCall(callId: string): Promise<CallePollResult>;
}

import type { CallStatus, TranscriptTurn } from "../domain/types.js";

/**
 * Provider-agnostic call gateway. ClaimLine talks to CALL-E only through this
 * interface, so the live SDK and the no-call fixture backend are interchangeable
 * and the rest of the app never depends on SDK-specific shapes.
 */
export interface CallRecipientRef {
  phone: string;
  region: string;
  locale: string;
}

export interface CallRequest {
  /** Stable idempotency key derived from the authorized intent. */
  idempotencyKey: string;
  task: string;
  resultSchema: Record<string, unknown>;
  recipient: CallRecipientRef;
  metadata?: Record<string, unknown>;
  /** Live mode only: CALL-E posts the terminal result here when provided. */
  webhookUrl?: string;
}

export interface CallHandle {
  callId: string;
  status: CallStatus;
}

export interface CallSnapshot {
  callId: string;
  status: CallStatus;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  structuredResult: Record<string, unknown> | null;
  evidence: string[];
  summary: string | null;
  transcript: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
}

export interface CalleGateway {
  readonly mode: "fixture" | "live";
  /** Place (or, in fixture mode, simulate) a call. Never dials twice for one key. */
  startCall(req: CallRequest): Promise<CallHandle>;
  /** Read the latest call state. Read-only and safe to poll. */
  getCall(callId: string): Promise<CallSnapshot>;
}

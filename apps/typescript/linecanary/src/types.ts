/**
 * App-facing call types.
 *
 * LineCanary talks to providers through its own types rather than the SDK's,
 * so the CALL-E SDK stays one adapter behind `CallePort` and a future
 * provider swap (or the local fake) never touches the engine. Field names are
 * camelCase everywhere in the app; the wire's snake_case lives only in the
 * fake server and the SDK's own parsing.
 */

export interface TranscriptTurn {
  /** Seconds from attempt start; null when the provider had no timestamp. */
  offsetSeconds: number | null;
  speaker: "bot" | "user" | string;
  text: string;
}

export interface Confidence {
  /** 0..1 task-completion confidence. */
  score: number;
  label: string;
}

export interface CallAttempt {
  id: string;
  phone: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  transcriptTurns: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
}

export interface CallRecipient {
  id: string;
  phones: string[];
  status: string;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  attempts: CallAttempt[];
}

export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export interface CallSnapshot {
  id: string;
  status: CallStatus;
  task: string;
  recipients: CallRecipient[];
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: Confidence | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type JsonSchema = Record<string, unknown>;

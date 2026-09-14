export type PrototypeCallStage =
  | "preparing"
  | "dialing"
  | "ringing"
  | "connected"
  | "conversation"
  | "processing"
  | "complete";
export type PrototypeCallInterruption =
  "cancelled" | "no-answer" | "failed" | "processing-failed";
export type PrototypeCallState = PrototypeCallStage | PrototypeCallInterruption;

export type PrototypeCallRecord = {
  runId?: string;
  status: PrototypeCallState;
  startedAt?: number;
  completedAt?: number;
  completionReason?: string;
  structuredResult?: unknown;
  error?: string;
};

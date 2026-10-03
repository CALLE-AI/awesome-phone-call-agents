// File: src/lib/calle-types.ts
// GoodFaith's internal normalized CALL-E-response contract. The deterministic core
// (normalize.ts) and the mock fixture are built against THIS shape. The live adapter
// (lib/calle.ts) maps the real @call-e/calle `Call` object into this shape, so the
// normalizer never has to know the SDK's on-the-wire naming. See NOTES.md (SDK probe).
import type { RecipientResult, TaskRollup } from "@/lib/schemas";

export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

export interface TranscriptTurn {
  offset_seconds: number;
  speaker: string;
  text: string;
}

export interface CallAttempt {
  status: string;
  transcript_turns: TranscriptTurn[];
  started_at?: string;
  ended_at?: string;
}

export interface CallRecipient {
  phone?: string;
  name?: string;
  status: CallStatus;
  summary?: string;
  structured_result: RecipientResult | null;
  attempts: CallAttempt[];
}

export interface CompletionConfidence {
  score: number; // 0..1
  label: string;
}

export interface CallTask {
  id: string;
  status: CallStatus;
  structured_result: TaskRollup | null;
  summary?: string;
  task_completed: boolean;
  completion_confidence?: CompletionConfidence;
  evidence?: string[];
  recipients: CallRecipient[];
  failure_code?: string | null;
  failure_message?: string | null;
  created_at?: string;
  completed_at?: string;
  metadata?: Record<string, unknown>;
}

export interface CallEvent {
  id: string;
  type: string; // e.g. "call.queued" | "call.in_progress" | "call.completed"
  created_at: string;
  data?: Record<string, unknown>;
}

export interface WebhookEnvelope {
  id: string;
  type: "call.completed" | "call.failed" | "call.result_validation_failed";
  created_at: string;
  data: CallTask;
}

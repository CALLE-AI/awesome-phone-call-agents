export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";
export type Outcome = "yes" | "no" | "unknown";

export type RecipientInput = {
  phones: string[];
  metadata?: Record<string, string>;
};

export type ResultSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: false;
};

export type CreateCallInput = {
  task: string;
  recipients?: RecipientInput[];
  resultSchema?: ResultSchema;
  recipientResultSchema?: ResultSchema;
  metadata?: Record<string, string>;
  webhookUrl?: string;
  idempotencyKey: string;
};

export type CalleRecipient = {
  id: string;
  phones: string[];
  status: CallStatus | string;
  structured_result?: Record<string, unknown> | null;
  summary?: string | null;
};

export type CalleCall = {
  id: string;
  object: "call_task";
  status: CallStatus;
  task: string;
  recipients: CalleRecipient[];
  structured_result: Record<string, unknown> | null;
  summary: string | null;
  task_completed: boolean | null;
  completion_confidence: number | null;
  evidence: string[];
  metadata: Record<string, string>;
  created_at?: string;
  updated_at?: string;
};

export type CalleEvent = {
  id: string;
  type: string;
  created_at: string;
  data: CalleCall;
};

export interface Provider {
  createCall(input: CreateCallInput, signal?: AbortSignal): Promise<CalleCall>;
  getCall(id: string, signal?: AbortSignal): Promise<CalleCall>;
  getEvents(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ events: CalleEvent[]; nextCursor?: string }>;
}

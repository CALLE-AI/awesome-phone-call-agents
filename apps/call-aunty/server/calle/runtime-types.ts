export type CalleTransport = "rest" | "sdk" | "mock";

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: string[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

export type CreateCallRequest = {
  task: string;
  recipients: { phones: string[]; region?: string; locale?: string }[];
  resultSchema?: JsonSchema;
  recipientResultSchema?: JsonSchema;
  metadata?: Record<string, string>;
  idempotencyKey: string;
  webhookUrl?: string;
};

export type CallTask = {
  id: string;
  object?: "call_task";
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  task: string;
  recipients: unknown[];
  structured_result?: unknown;
  summary?: string | null;
  task_completed?: boolean;
  completion_confidence?: { score: number; label: string } | null;
  evidence?: string[];
  metadata?: Record<string, string>;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type CallEvent = {
  id: string;
  type: string;
  call_id: string;
  created_at: string;
  level?: string;
  status?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type CallEventPage = {
  object: "list";
  data: CallEvent[];
  next_cursor?: string | null;
};

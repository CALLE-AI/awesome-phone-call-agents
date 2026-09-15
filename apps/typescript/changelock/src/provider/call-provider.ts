export interface ReservedCallInput {
  task: string;
  phoneE164: string;
  region: string;
  locale: string;
  recipientResultSchema: Record<string, unknown>;
  metadata: {
    intentId: string;
    caseId: string;
    requestHash: string;
    taskVersion: string;
    schemaVersion: string;
  };
  idempotencyKey: string;
}

export interface ProviderCallSnapshot {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  taskCompleted: boolean | null;
  recipientStatus: string | null;
  confidenceScore: number | null;
  structuredResult: Record<string, unknown> | null;
  evidence: string[];
  failureCode: string | null;
  dialedPhoneE164: string | null;
  metadata: Record<string, unknown>;
}

export type SafeProviderErrorCode =
  | "auth_missing"
  | "auth_invalid"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_request"
  | "not_allowlisted"
  | "network_error"
  | "unknown";

export type CreateCallOutcome =
  | { kind: "accepted"; snapshot: ProviderCallSnapshot }
  | { kind: "rejected"; code: SafeProviderErrorCode }
  | { kind: "acceptance_unknown"; code: SafeProviderErrorCode };

export interface CallProvider {
  create(input: ReservedCallInput): Promise<CreateCallOutcome>;
  get(callId: string): Promise<ProviderCallSnapshot>;
}

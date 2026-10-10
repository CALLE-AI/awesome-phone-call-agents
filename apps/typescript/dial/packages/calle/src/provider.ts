import type {
  CalleCallStatus,
  CalleAttemptStatus,
  TranscriptTurn,
  CompletionConfidence,
  JsonSchema,
} from '@dial/schemas';

/** The seam every calling backend implements. Nothing above it knows about CALL-E. */

export interface ProviderCallRequest {
  /** Goal-oriented brief for the agent. Not a word-for-word script. */
  task: string;
  /** Already normalised to E.164 and validated before it reaches here. */
  phone: string;
  resultSchema: JsonSchema;
  metadata: Record<string, unknown>;
  /** Stable, derived from task+candidate+attempt. Never a fresh UUID. */
  idempotencyKey: string;
  webhookUrl?: string;
  locale?: string;
}

export interface ProviderAttempt {
  id: string;
  phoneMasked: string | null;
  status: CalleAttemptStatus;
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  transcript: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
}

export interface ProviderCallSnapshot {
  providerCallId: string;
  status: CalleCallStatus;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: CompletionConfidence | null;
  evidence: string[];
  attempts: ProviderAttempt[];
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CallProvider {
  readonly name: 'calle' | 'fake';
  /** True when this provider dials real telephones. Drives every UI warning. */
  readonly placesRealCalls: boolean;
  create(request: ProviderCallRequest): Promise<ProviderCallSnapshot>;
  get(providerCallId: string): Promise<ProviderCallSnapshot>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isTerminal(status: CalleCallStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

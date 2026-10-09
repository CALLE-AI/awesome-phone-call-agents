import type { ApprovedBookingContract } from "../../domain/booking-contract.js";
import type { BookingExecutionContext } from "../../domain/execution-context.js";

export interface ProviderCallResult {
  providerCallId: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  taskCompleted: boolean | null;
  completionConfidence: {
    score: number;
    label: string;
  } | null;
  structuredResult: unknown;
  evidence: readonly string[];
  summary: string | null;
  transcript: readonly string[];
  failureCode: string | null;
  failureMessage: string | null;
}

export class AcceptedCallStatusUnknownError extends Error {
  readonly providerCallId: string;

  constructor(providerCallId: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : "Unknown CALL-E status error";
    super(
      `CALL-E accepted call ${providerCallId}, but DineLine could not confirm its terminal status: ${detail}`,
    );
    this.name = "AcceptedCallStatusUnknownError";
    this.providerCallId = providerCallId;
  }
}

export class CallReconciliationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallReconciliationRejectedError";
  }
}

export function acceptedProviderCallId(error: unknown): string | null {
  return error instanceof AcceptedCallStatusUnknownError
    ? error.providerCallId
    : null;
}

export function isTerminalCallResult(result: ProviderCallResult): boolean {
  return ["completed", "failed", "canceled"].includes(result.status);
}

export interface BookingCallProvider {
  readonly name: string;
  execute(
    contract: ApprovedBookingContract,
    idempotencyKey: string,
    context: BookingExecutionContext,
  ): Promise<ProviderCallResult>;
  getResult?(providerCallId: string): Promise<ProviderCallResult>;
}

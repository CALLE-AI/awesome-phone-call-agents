import type { CallAttempt, CallAttemptTerminalOutcome, OrganizationId } from "@muster/domain";

export type CallAttemptEstablishResult = Readonly<{
  outcome: "established" | "replayed";
  value: CallAttempt;
}>;

export type CallAttemptTransitionResult = Readonly<{
  outcome: "transitioned" | "replayed";
  value: CallAttempt;
}>;

export interface CallAttemptRepository {
  establish(input: {
    readonly idempotencyKey: string;
    readonly attempt: CallAttempt;
  }): Promise<CallAttemptEstablishResult>;
  findById(organizationId: OrganizationId, operationId: string): Promise<CallAttempt | undefined>;
  findPendingDispatches(limit: number): Promise<readonly CallAttempt[]>;
  recordCalling(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult>;
  recordExtracting(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly evidenceId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult>;
  recordTerminalObservation(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly observationId: string;
    readonly transitionedAt: string;
  }): Promise<CallAttemptTransitionResult>;
  recordTerminalFailure(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly outcome: Exclude<CallAttemptTerminalOutcome, "observation_recorded">;
    readonly retryable: boolean;
    readonly transitionedAt: string;
  }): Promise<CallAttempt>;
}

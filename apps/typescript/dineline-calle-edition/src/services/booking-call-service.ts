import type { ApprovedBookingContract } from "../domain/booking-contract.js";
import type { VerifiedBookingOutcome } from "../domain/call-result.js";
import {
  createExecutionContext,
  type BookingExecutionContext,
} from "../domain/execution-context.js";
import {
  acceptedProviderCallId,
  CallReconciliationRejectedError,
  isTerminalCallResult,
  type BookingCallProvider,
} from "../providers/calle/types.js";
import type {
  IdempotencyStore,
  ReservationState,
} from "./idempotency-store.js";
import { redactPhoneNumbers } from "../security/phone-redaction.js";
import { verifyBookingOutcome } from "./result-verifier.js";

export type BookingCallExecution =
  | {
      kind: "completed";
      state: "completed";
      correlationId: string;
      outcome: VerifiedBookingOutcome;
    }
  | {
      kind: "dispatch_unknown";
      state: "dispatch_unknown";
      correlationId: string;
      outcome: VerifiedBookingOutcome;
    }
  | {
      kind: "duplicate_blocked";
      state: ReservationState;
      correlationId: string;
      idempotencyKey: string;
    };

export class BookingCallService {
  constructor(
    readonly provider: BookingCallProvider,
    readonly store: IdempotencyStore,
  ) {}

  async execute(
    contract: ApprovedBookingContract,
    context: BookingExecutionContext = createExecutionContext(contract.contractId),
  ): Promise<BookingCallExecution> {
    const reservedAt = new Date().toISOString();
    const reserved = await this.store.reserve({
      idempotencyKey: contract.idempotencyKey,
      contractId: contract.contractId,
      correlationId: context.correlationId,
      n8nExecutionId: context.n8nExecutionId,
      sourceCallId: context.sourceCallId,
      toolCallId: context.toolCallId,
      state: "reserved",
      reservedAt,
      updatedAt: reservedAt,
    });

    if (!reserved) {
      const current = await this.store.read(contract.idempotencyKey);
      return {
        kind: "duplicate_blocked",
        state: current.state,
        correlationId: current.correlationId,
        idempotencyKey: contract.idempotencyKey,
      };
    }

    await this.store.update(contract.idempotencyKey, {
      state: "dispatching",
      updatedAt: new Date().toISOString(),
    });

    try {
      const raw = await this.provider.execute(
        contract,
        contract.idempotencyKey,
        context,
      );
      const outcome = verifyBookingOutcome(contract, raw);
      const completedAt = new Date().toISOString();
      await this.store.update(contract.idempotencyKey, {
        state: "completed",
        updatedAt: completedAt,
        completedAt,
        providerCallId: outcome.providerCallId,
        outcome: outcome.outcome,
      });
      return {
        kind: "completed",
        state: "completed",
        correlationId: context.correlationId,
        outcome,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider error";
      const providerCallId = acceptedProviderCallId(error);
      const outcome = unknownBookingOutcome(providerCallId, message);
      const updatedAt = new Date().toISOString();
      await this.store.update(contract.idempotencyKey, {
        state: "dispatch_unknown",
        updatedAt,
        providerCallId,
        outcome: outcome.outcome,
      });
      return {
        kind: "dispatch_unknown",
        state: "dispatch_unknown",
        correlationId: context.correlationId,
        outcome,
      };
    }
  }

  async reconcile(
    contract: ApprovedBookingContract,
  ): Promise<BookingCallExecution> {
    const current = await this.store.read(contract.idempotencyKey);
    if (current.contractId !== contract.contractId) {
      throw new CallReconciliationRejectedError(
        "The stored call does not match this approved booking contract.",
      );
    }

    if (current.state !== "dispatch_unknown") {
      return {
        kind: "duplicate_blocked",
        state: current.state,
        correlationId: current.correlationId,
        idempotencyKey: contract.idempotencyKey,
      };
    }

    if (!current.providerCallId) {
      throw new CallReconciliationRejectedError(
        "No accepted CALL-E call ID was stored, so status cannot be reconciled safely.",
      );
    }

    if (!this.provider.getResult) {
      throw new CallReconciliationRejectedError(
        "This provider cannot read an existing CALL-E call.",
      );
    }

    let raw;
    try {
      raw = await this.provider.getResult(current.providerCallId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown status error";
      return {
        kind: "dispatch_unknown",
        state: "dispatch_unknown",
        correlationId: current.correlationId,
        outcome: unknownBookingOutcome(current.providerCallId, message),
      };
    }

    if (raw.providerCallId !== current.providerCallId) {
      throw new CallReconciliationRejectedError(
        "CALL-E returned a different call ID than the one bound to this booking.",
      );
    }

    if (!isTerminalCallResult(raw)) {
      return {
        kind: "dispatch_unknown",
        state: "dispatch_unknown",
        correlationId: current.correlationId,
        outcome: pendingBookingOutcome(current.providerCallId),
      };
    }

    const outcome = verifyBookingOutcome(contract, raw);
    const completedAt = new Date().toISOString();
    await this.store.update(contract.idempotencyKey, {
      state: "completed",
      updatedAt: completedAt,
      completedAt,
      providerCallId: outcome.providerCallId,
      outcome: outcome.outcome,
    });
    return {
      kind: "completed",
      state: "completed",
      correlationId: current.correlationId,
      outcome,
    };
  }
}

function unknownBookingOutcome(
  providerCallId: string | null,
  message: string,
): VerifiedBookingOutcome {
  const publicMessage = redactPhoneNumbers(message);
  return {
    outcome: "uncertain",
    providerCallId,
    confidence: 0,
    summary: providerCallId
      ? `CALL-E accepted the call, but DineLine has not confirmed the final result yet. Do not call again. Check this call's status instead. ${publicMessage}`
      : `CALL-E execution failed safely: ${publicMessage}`,
    evidence: [],
    needsHumanReview: true,
    confirmationCode: null,
    alternativeDate: null,
    alternativeTime: null,
  };
}

function pendingBookingOutcome(providerCallId: string): VerifiedBookingOutcome {
  return {
    ...unknownBookingOutcome(providerCallId, "The call is still queued or in progress."),
    summary:
      "CALL-E is still processing the accepted call. No second call was placed; check this call again later.",
  };
}

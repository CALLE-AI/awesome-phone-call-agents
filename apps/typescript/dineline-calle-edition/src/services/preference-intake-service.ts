import type { ApprovedPreferenceIntakeContract } from "../domain/dining-preferences.js";
import {
  createIntakeExecutionContext,
  type IntakeExecutionContext,
} from "../domain/execution-context.js";
import type { PreferenceIntakeProvider } from "../providers/calle/intake-types.js";
import {
  acceptedProviderCallId,
  CallReconciliationRejectedError,
  isTerminalCallResult,
} from "../providers/calle/types.js";
import type {
  IdempotencyStore,
  ReservationState,
} from "./idempotency-store.js";
import { redactPhoneNumbers } from "../security/phone-redaction.js";
import {
  verifyPreferenceOutcome,
  type VerifiedPreferenceOutcome,
} from "./preference-result-verifier.js";

export type PreferenceIntakeExecution =
  | {
      kind: "completed";
      state: "completed";
      correlationId: string;
      outcome: VerifiedPreferenceOutcome;
    }
  | {
      kind: "dispatch_unknown";
      state: "dispatch_unknown";
      correlationId: string;
      outcome: VerifiedPreferenceOutcome;
    }
  | {
      kind: "duplicate_blocked";
      state: ReservationState;
      correlationId: string;
      idempotencyKey: string;
    };

export class PreferenceIntakeService {
  constructor(
    readonly provider: PreferenceIntakeProvider,
    readonly store: IdempotencyStore,
  ) {}

  async execute(
    contract: ApprovedPreferenceIntakeContract,
    context: IntakeExecutionContext = createIntakeExecutionContext(
      contract.requestId,
    ),
  ): Promise<PreferenceIntakeExecution> {
    const reservedAt = new Date().toISOString();
    const reserved = await this.store.reserve({
      idempotencyKey: contract.idempotencyKey,
      contractId: contract.requestId,
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
      const outcome = verifyPreferenceOutcome(raw);
      const completedAt = new Date().toISOString();
      await this.store.update(contract.idempotencyKey, {
        state: "completed",
        updatedAt: completedAt,
        completedAt,
        providerCallId: outcome.providerCallId,
        outcome: outcome.usableForSearch ? "preferences_ready" : "needs_input",
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
      const outcome = unknownPreferenceOutcome(providerCallId, message);
      const updatedAt = new Date().toISOString();
      await this.store.update(contract.idempotencyKey, {
        state: "dispatch_unknown",
        updatedAt,
        providerCallId,
        outcome: "uncertain",
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
    contract: ApprovedPreferenceIntakeContract,
  ): Promise<PreferenceIntakeExecution> {
    const current = await this.store.read(contract.idempotencyKey);
    if (current.contractId !== contract.requestId) {
      throw new CallReconciliationRejectedError(
        "The stored call does not match this approved preference request.",
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
        outcome: unknownPreferenceOutcome(current.providerCallId, message),
      };
    }

    if (raw.providerCallId !== current.providerCallId) {
      throw new CallReconciliationRejectedError(
        "CALL-E returned a different call ID than the one bound to this preference request.",
      );
    }

    if (!isTerminalCallResult(raw)) {
      return {
        kind: "dispatch_unknown",
        state: "dispatch_unknown",
        correlationId: current.correlationId,
        outcome: pendingPreferenceOutcome(current.providerCallId),
      };
    }

    const outcome = verifyPreferenceOutcome(raw);
    const completedAt = new Date().toISOString();
    await this.store.update(contract.idempotencyKey, {
      state: "completed",
      updatedAt: completedAt,
      completedAt,
      providerCallId: outcome.providerCallId,
      outcome: outcome.usableForSearch ? "preferences_ready" : "needs_input",
    });
    return {
      kind: "completed",
      state: "completed",
      correlationId: current.correlationId,
      outcome,
    };
  }
}

function unknownPreferenceOutcome(
  providerCallId: string | null,
  message: string,
): VerifiedPreferenceOutcome {
  const publicMessage = redactPhoneNumbers(message);
  return {
    preferences: null,
    usableForSearch: false,
    missingFields: ["location", "cuisine", "date", "time", "partySize"],
    providerCallId,
    confidence: 0,
    summary: providerCallId
      ? `CALL-E accepted the planning call, but DineLine has not confirmed the final result yet. Do not call again. Check this call's status instead. ${publicMessage}`
      : `CALL-E preference intake failed safely: ${publicMessage}`,
    evidence: [],
    needsUserInput: true,
  };
}

function pendingPreferenceOutcome(
  providerCallId: string,
): VerifiedPreferenceOutcome {
  return {
    ...unknownPreferenceOutcome(
      providerCallId,
      "The call is still queued or in progress.",
    ),
    summary:
      "CALL-E is still processing the accepted planning call. No second call was placed; check this call again later.",
  };
}

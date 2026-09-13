import type { ObservationJobPayload, W3CTraceContext } from "@muster/contracts";
import { OrganizationId, type CallAttempt } from "@muster/domain";

import { ApplicationError } from "../errors/application-error.js";
import type { CallAttemptRepository } from "../ports/call-attempt.repository.js";
import type { Clock } from "../ports/clock.port.js";
import type { ObservationDispatchPolicyPort } from "../ports/observation-dispatch-policy.port.js";
import type { ObservationProfileRepository } from "../ports/observation-profile.repository.js";
import {
  VoiceCallDispatchError,
  type VoiceCallPortFactory,
  type VoiceCallResult,
} from "../ports/voice-call.port.js";
import type { RecordObservationResult } from "./record-observation-result.js";

export interface StartObservationCallDependencies {
  readonly attempts: CallAttemptRepository;
  readonly profiles: ObservationProfileRepository;
  readonly policy: ObservationDispatchPolicyPort;
  readonly providerFactory: VoiceCallPortFactory;
  readonly clock: Clock;
  readonly recordResult: Pick<RecordObservationResult, "execute">;
}

export interface ObservationDeliveryAttempt {
  readonly attemptNumber: number;
  readonly finalAttempt: boolean;
}

const directDelivery = Object.freeze({ attemptNumber: 1, finalAttempt: true });

export class StartObservationCall {
  public constructor(private readonly dependencies: StartObservationCallDependencies) {}

  public async execute(input: {
    readonly organizationId: OrganizationId;
    readonly operationId: string;
    readonly correlationId: string;
    readonly traceContext?: W3CTraceContext;
    readonly delivery?: ObservationDeliveryAttempt;
  }): Promise<CallAttempt> {
    let attempt = await this.dependencies.attempts.findById(
      input.organizationId,
      input.operationId,
    );
    if (attempt === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    if (attempt.stage === "terminal") {
      return attempt;
    }
    // Every delivery re-evaluates current dispatch authority before provider construction; a
    // queued or previously claimed attempt never grandfathers authorization or safety state.
    const profile = await this.dependencies.profiles.findByEndpoint(
      input.organizationId,
      attempt.endpointId,
    );
    if (profile === undefined || profile.adapterVersionId !== attempt.adapterVersionId) {
      return await this.dependencies.attempts.recordTerminalFailure({
        organizationId: input.organizationId,
        operationId: input.operationId,
        outcome: "blocked",
        retryable: false,
        transitionedAt: this.dependencies.clock.now(),
      });
    }
    const decision = await this.dependencies.policy.evaluate({ profile, attempt });
    if (decision.outcome === "blocked") {
      return await this.dependencies.attempts.recordTerminalFailure({
        organizationId: input.organizationId,
        operationId: input.operationId,
        outcome: "blocked",
        retryable: false,
        transitionedAt: this.dependencies.clock.now(),
      });
    }
    if (attempt.stage === "scheduled") {
      const claim = await this.dependencies.attempts.recordCalling({
        organizationId: input.organizationId,
        operationId: input.operationId,
        transitionedAt: this.dependencies.clock.now(),
      });
      attempt = claim.value;
      if (attempt.stage === "terminal") {
        return attempt;
      }
      if (attempt.stage === "scheduled") {
        throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
      }
    }
    let result: VoiceCallResult;
    try {
      const port = this.dependencies.providerFactory.create();
      result = await port.createOrReconcile({
        organizationId: input.organizationId,
        operationId: input.operationId,
        providerDispatchIdentity: attempt.providerDispatchIdentity,
        instructionFingerprint:
          profile.dtmfPolicy.kind === "forbidden"
            ? "dtmf-forbidden.v1"
            : profile.dtmfPolicy.instructionFingerprint,
        dtmfPolicy: profile.dtmfPolicy,
        correlationId: input.correlationId,
        ...(input.traceContext === undefined ? {} : { traceContext: input.traceContext }),
      });
    } catch (error) {
      const failure =
        error instanceof VoiceCallDispatchError
          ? error
          : VoiceCallDispatchError.providerFailed({ retryable: false });
      const delivery = input.delivery ?? directDelivery;
      if (failure.retryable && !delivery.finalAttempt) {
        throw failure;
      }
      // Retryable provider failures stay non-terminal while pg-boss can redeliver, but the final
      // delivery must leave a durable outcome instead of an indefinitely calling operation.
      return await this.dependencies.attempts.recordTerminalFailure({
        organizationId: input.organizationId,
        operationId: input.operationId,
        outcome: failure.outcome,
        retryable: failure.retryable,
        transitionedAt: this.dependencies.clock.now(),
      });
    }
    return (
      await this.dependencies.recordResult.execute({
        organizationId: input.organizationId,
        operationId: input.operationId,
        result,
      })
    ).attempt;
  }

  public async executeJob(
    payload: ObservationJobPayload,
    delivery: ObservationDeliveryAttempt = directDelivery,
  ): Promise<CallAttempt> {
    return await this.execute({
      organizationId: OrganizationId.create(payload.organizationId),
      operationId: payload.operationId,
      correlationId: payload.correlationId,
      delivery,
      ...(payload.traceContext === undefined ? {} : { traceContext: payload.traceContext }),
    });
  }
}

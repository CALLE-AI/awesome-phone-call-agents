import type { W3CTraceContext } from "@muster/contracts";
import { CallAttempt, type ObservationTrigger, type OrganizationId } from "@muster/domain";

import { ApplicationError } from "../errors/application-error.js";
import type { CallAttemptRepository } from "../ports/call-attempt.repository.js";
import type { Clock } from "../ports/clock.port.js";
import type { IdentifierGenerator } from "../ports/identifier-generator.port.js";
import type { ObservationJobSchedulerPort } from "../ports/observation-job-scheduler.port.js";
import type { ObservationProfileRepository } from "../ports/observation-profile.repository.js";

const REQUEST_CONTRACT_VERSION = "observation-request.v1";

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function opaqueIdentity(prefix: string, facts: readonly string[]): string {
  return `${prefix}-${fnv1a64(JSON.stringify(facts))}`;
}

export interface RequestObservationDependencies {
  readonly profiles: ObservationProfileRepository;
  readonly attempts: CallAttemptRepository;
  readonly scheduler: ObservationJobSchedulerPort;
  readonly clock: Clock;
  readonly identifiers: IdentifierGenerator;
}

export interface RequestObservationInput {
  readonly organizationId: OrganizationId;
  readonly endpointId: string;
  readonly pollWindowId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly trigger: ObservationTrigger;
  readonly traceContext?: W3CTraceContext;
}

export interface RequestObservationResult {
  readonly outcome: "established" | "replayed";
  readonly operation: CallAttempt;
  readonly schedulingOutcome: "scheduled" | "duplicate" | "deferred";
}

export class RequestObservation {
  public constructor(private readonly dependencies: RequestObservationDependencies) {}

  public async execute(input: RequestObservationInput): Promise<RequestObservationResult> {
    const profile = await this.dependencies.profiles.findByEndpoint(
      input.organizationId,
      input.endpointId,
    );
    if (profile === undefined) {
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
    const operationId = this.dependencies.identifiers.generate();
    const semanticFingerprint = opaqueIdentity("observation-request", [
      input.organizationId.value,
      input.endpointId,
      profile.adapterVersionId,
      input.pollWindowId,
      REQUEST_CONTRACT_VERSION,
    ]);
    const instructionFingerprint =
      profile.dtmfPolicy.kind === "forbidden"
        ? "dtmf-forbidden.v1"
        : profile.dtmfPolicy.instructionFingerprint;
    const attempt = CallAttempt.establish({
      id: operationId,
      organizationId: input.organizationId,
      endpointId: input.endpointId,
      adapterVersionId: profile.adapterVersionId,
      trigger: input.trigger,
      provenance: profile.provenance,
      semanticFingerprint,
      providerDispatchIdentity: opaqueIdentity("provider-dispatch", [
        operationId,
        instructionFingerprint,
      ]),
      acceptedAt: this.dependencies.clock.now(),
    });
    const established = await this.dependencies.attempts.establish({
      idempotencyKey: input.idempotencyKey,
      attempt,
    });
    // The attempt is durable before queue admission, so a rejected or lost enqueue remains
    // recoverable without inventing a second operation identity.
    const schedule = await this.dependencies.scheduler.scheduleObservation({
      version: "1",
      organizationId: established.value.organizationId.value,
      operationId: established.value.id,
      correlationId: input.correlationId,
      ...(input.traceContext === undefined ? {} : { traceContext: input.traceContext }),
    });
    return Object.freeze({
      outcome: established.outcome,
      operation: established.value,
      schedulingOutcome: schedule.outcome === "rejected" ? "deferred" : schedule.outcome,
    });
  }
}

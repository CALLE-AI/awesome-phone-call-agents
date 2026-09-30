import {
  ApplicationError,
  type FleetActiveManualOperationFact,
  type FleetAttemptFact,
  type FleetCompleteObservationFact,
  type FleetEndpointFacts,
  type FleetHealthRepository,
  type FleetTerminalAttemptFact,
} from "@muster/application";
import type { OrganizationId } from "@muster/domain";

import type { PrismaClient } from "./generated/prisma/client.js";

type PersistedProvenance = "simulated" | "providerObserved";
type PersistedTerminalOutcome =
  | "observationRecorded"
  | "blocked"
  | "noAnswer"
  | "busy"
  | "providerFailed"
  | "evidenceUnavailable";

function toProvenance(value: PersistedProvenance): "SIMULATED" | "PROVIDER_OBSERVED" {
  return value === "simulated" ? "SIMULATED" : "PROVIDER_OBSERVED";
}

function toTerminalOutcome(
  value: PersistedTerminalOutcome,
):
  | "observation_recorded"
  | "blocked"
  | "no_answer"
  | "busy"
  | "provider_failed"
  | "evidence_unavailable" {
  const outcomes = {
    observationRecorded: "observation_recorded",
    blocked: "blocked",
    noAnswer: "no_answer",
    busy: "busy",
    providerFailed: "provider_failed",
    evidenceUnavailable: "evidence_unavailable",
  } as const;
  return outcomes[value];
}

function toAttemptFact(record: {
  readonly id: string;
  readonly resourceVersion: number;
  readonly trigger: "manual" | "scheduled";
  readonly provenance: PersistedProvenance;
  readonly acceptedAt: Date;
  readonly lastTransitionAt: Date;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly terminalOutcome: PersistedTerminalOutcome | null;
  readonly retryable: boolean | null;
  readonly latestObservation: {
    readonly quality: "complete" | "partial" | "unknown" | "invalid";
  } | null;
}): FleetAttemptFact {
  return Object.freeze({
    operationId: record.id,
    resourceVersion: record.resourceVersion,
    trigger: record.trigger,
    provenance: toProvenance(record.provenance),
    acceptedAt: record.acceptedAt.toISOString(),
    lastTransitionAt: record.lastTransitionAt.toISOString(),
    stage: record.stage,
    terminalOutcome:
      record.terminalOutcome === null ? null : toTerminalOutcome(record.terminalOutcome),
    retryable: record.retryable,
    observationQuality: record.latestObservation?.quality ?? null,
  });
}

function toTerminalAttemptFact(record: {
  readonly id: string;
  readonly acceptedAt: Date;
  readonly terminalOutcome: PersistedTerminalOutcome | null;
  readonly latestObservation: {
    readonly quality: "complete" | "partial" | "unknown" | "invalid";
  } | null;
}): FleetTerminalAttemptFact {
  if (record.terminalOutcome === null) {
    throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
  }
  return Object.freeze({
    operationId: record.id,
    acceptedAt: record.acceptedAt.toISOString(),
    terminalOutcome: toTerminalOutcome(record.terminalOutcome),
    observationQuality: record.latestObservation?.quality ?? null,
  });
}

function toActiveManualOperation(record: {
  readonly id: string;
  readonly resourceVersion: number;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly acceptedAt: Date;
}): FleetActiveManualOperationFact {
  if (record.stage === "terminal") {
    throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
  }
  return Object.freeze({
    operationId: record.id,
    resourceVersion: record.resourceVersion,
    stage: record.stage,
    acceptedAt: record.acceptedAt.toISOString(),
  });
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class PrismaFleetHealthRepository implements FleetHealthRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async listFacts(organizationId: OrganizationId): Promise<readonly FleetEndpointFacts[]> {
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const endpoints = await transaction.endpoint.findMany({
            where: { organizationId: organizationId.value },
            select: {
              id: true,
              siteDisplayName: true,
              endpointDisplayName: true,
              freshnessWindowSeconds: true,
              activeAdapterVersion: { select: { provenance: true } },
            },
          });
          const endpointIds = endpoints.map((endpoint) => endpoint.id);
          if (endpointIds.length === 0) return [];

          const attemptSelection = {
            id: true,
            endpointId: true,
            resourceVersion: true,
            trigger: true,
            provenance: true,
            acceptedAt: true,
            lastTransitionAt: true,
            stage: true,
            terminalOutcome: true,
            retryable: true,
            latestObservation: { select: { quality: true } },
          } as const;
          // Prisma groupBy cannot return the row that owns a maximum. Resolve maxima first so the
          // candidate reads remain bounded to rows tied at one timestamp per endpoint.
          const attemptGroups = await Promise.all([
            transaction.callAttempt.groupBy({
              by: ["endpointId"],
              where: { organizationId: organizationId.value, endpointId: { in: endpointIds } },
              _max: { acceptedAt: true },
            }),
            transaction.callAttempt.groupBy({
              by: ["endpointId"],
              where: {
                organizationId: organizationId.value,
                endpointId: { in: endpointIds },
                stage: "terminal",
              },
              _max: { acceptedAt: true },
            }),
            transaction.callAttempt.groupBy({
              by: ["endpointId"],
              where: {
                organizationId: organizationId.value,
                endpointId: { in: endpointIds },
                trigger: "manual",
                stage: { not: "terminal" },
              },
              _max: { acceptedAt: true },
            }),
            transaction.evidenceRecord.groupBy({
              by: ["endpointId"],
              where: {
                organizationId: organizationId.value,
                endpointId: { in: endpointIds },
                observations: { some: { quality: "complete" } },
              },
              _max: { capturedAt: true },
            }),
          ]);
          const atMax = (
            groups: readonly { endpointId: string; _max: { acceptedAt: Date | null } }[],
          ) =>
            groups.flatMap((group) =>
              group._max.acceptedAt === null
                ? []
                : [{ endpointId: group.endpointId, acceptedAt: group._max.acceptedAt }],
            );
          const [
            lastAttempts,
            latestTerminalAttempts,
            activeManualOperations,
            completeObservations,
          ] = await Promise.all([
            transaction.callAttempt.findMany({
              where: { organizationId: organizationId.value, OR: atMax(attemptGroups[0]) },
              select: attemptSelection,
            }),
            transaction.callAttempt.findMany({
              where: {
                organizationId: organizationId.value,
                OR: atMax(attemptGroups[1]),
                stage: "terminal",
              },
              select: attemptSelection,
            }),
            transaction.callAttempt.findMany({
              where: {
                organizationId: organizationId.value,
                OR: atMax(attemptGroups[2]),
                trigger: "manual",
                stage: { not: "terminal" },
              },
              select: {
                id: true,
                endpointId: true,
                resourceVersion: true,
                stage: true,
                acceptedAt: true,
              },
            }),
            transaction.observation.findMany({
              where: {
                organizationId: organizationId.value,
                quality: "complete",
                OR: attemptGroups[3].flatMap((group) =>
                  group._max.capturedAt === null
                    ? []
                    : [
                        {
                          endpointId: group.endpointId,
                          evidence: { capturedAt: group._max.capturedAt },
                        },
                      ],
                ),
              },
              select: {
                id: true,
                endpointId: true,
                operationId: true,
                version: true,
                createdAt: true,
                provenance: true,
                evidenceId: true,
                adapterVersionId: true,
                extractorVersionId: true,
                reconciliationPolicyVersion: true,
                evidence: { select: { capturedAt: true } },
                callAttempt: { select: { acceptedAt: true } },
              },
            }),
          ]);

          // Grouped maxima may tie, so select one row per endpoint with a stable total order. The
          // complete-observation order is intentionally independent from the latest-attempt order.
          const greatest = <T extends { endpointId: string }>(
            records: readonly T[],
            compare: (left: T, right: T) => number,
          ): T[] =>
            [...records]
              .sort(
                (left, right) =>
                  codeUnitCompare(left.endpointId, right.endpointId) || -compare(left, right),
              )
              .filter(
                (record, index, all) =>
                  index === 0 || record.endpointId !== all[index - 1]?.endpointId,
              );
          const selectedLastAttempts = greatest(
            lastAttempts,
            (a, b) =>
              a.acceptedAt.getTime() - b.acceptedAt.getTime() || codeUnitCompare(a.id, b.id),
          );
          const selectedTerminalAttempts = greatest(
            latestTerminalAttempts,
            (a, b) =>
              a.acceptedAt.getTime() - b.acceptedAt.getTime() || codeUnitCompare(a.id, b.id),
          );
          const selectedActiveManual = greatest(
            activeManualOperations,
            (a, b) =>
              a.acceptedAt.getTime() - b.acceptedAt.getTime() || codeUnitCompare(a.id, b.id),
          );
          const selectedComplete = greatest(
            completeObservations,
            (a, b) =>
              a.evidence.capturedAt.getTime() - b.evidence.capturedAt.getTime() ||
              codeUnitCompare(a.operationId, b.operationId) ||
              a.version - b.version ||
              codeUnitCompare(a.id, b.id),
          );

          const attemptsByEndpoint = new Map(
            selectedLastAttempts.map((attempt) => [attempt.endpointId, toAttemptFact(attempt)]),
          );
          const terminalsByEndpoint = new Map(
            selectedTerminalAttempts.map((attempt) => [
              attempt.endpointId,
              toTerminalAttemptFact(attempt),
            ]),
          );
          const activeByEndpoint = new Map(
            selectedActiveManual.map((attempt) => [
              attempt.endpointId,
              toActiveManualOperation(attempt),
            ]),
          );
          const completeByEndpoint = new Map<string, FleetCompleteObservationFact>(
            selectedComplete.map((observation) => [
              observation.endpointId,
              Object.freeze({
                observationId: observation.id,
                operationId: observation.operationId,
                originatingAttemptAcceptedAt: observation.callAttempt.acceptedAt.toISOString(),
                version: observation.version,
                observedAt: observation.evidence.capturedAt.toISOString(),
                completedAt: observation.createdAt.toISOString(),
                provenance: toProvenance(observation.provenance),
                evidenceId: observation.evidenceId,
                adapterVersionId: observation.adapterVersionId,
                extractorVersionId: observation.extractorVersionId,
                reconciliationPolicyVersion: observation.reconciliationPolicyVersion,
                quality: "complete",
              }),
            ]),
          );

          return endpoints
            .map((endpoint): FleetEndpointFacts => {
              if (endpoint.activeAdapterVersion === null) {
                throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
              }
              return Object.freeze({
                endpointId: endpoint.id,
                siteDisplayName: endpoint.siteDisplayName,
                endpointDisplayName: endpoint.endpointDisplayName,
                provenance: toProvenance(endpoint.activeAdapterVersion.provenance),
                freshnessWindowSeconds: endpoint.freshnessWindowSeconds,
                lastAttempt: attemptsByEndpoint.get(endpoint.id) ?? null,
                latestTerminalAttempt: terminalsByEndpoint.get(endpoint.id) ?? null,
                lastCompleteObservation: completeByEndpoint.get(endpoint.id) ?? null,
                activeManualOperation: activeByEndpoint.get(endpoint.id) ?? null,
              });
            })
            .sort(
              (left, right) =>
                codeUnitCompare(left.siteDisplayName ?? "", right.siteDisplayName ?? "") ||
                codeUnitCompare(left.endpointDisplayName ?? "", right.endpointDisplayName ?? "") ||
                codeUnitCompare(left.endpointId, right.endpointId),
            );
        },
        { isolationLevel: "RepeatableRead" },
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
    }
  }
}

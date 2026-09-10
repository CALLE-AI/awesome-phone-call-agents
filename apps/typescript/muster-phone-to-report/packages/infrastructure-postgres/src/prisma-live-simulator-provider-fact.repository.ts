import {
  ApplicationError,
  type LiveSimulatorProviderFact,
  type LiveSimulatorProviderFactRepository,
} from "@muster/application";
import { OrganizationId } from "@muster/domain";

import type { PrismaClient } from "./generated/prisma/client.js";

const digestPattern = /^[0-9a-f]{64}$/u;
const tracePattern = /^[0-9a-f]{32}$/u;
const operationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const phases = new Set(["voice", "canary", "status", "calle_terminal", "reconciliation"]);
const outcomes = new Set([
  "accepted",
  "zero_dtmf",
  "dtmf_observed",
  "completed",
  "failed",
  "admissible",
  "inadmissible",
  "one_matching_call",
  "zero_calls",
  "mismatched_call",
  "multiple_calls",
  "timeout",
]);

function instant(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw ApplicationError.validation("live_provider_fact_invalid");
  }
  return parsed;
}

function validate(fact: LiveSimulatorProviderFact): Date {
  if (
    !operationPattern.test(fact.operationId) ||
    !phases.has(fact.phase) ||
    !outcomes.has(fact.outcome) ||
    !digestPattern.test(fact.providerCallDigest) ||
    !digestPattern.test(fact.semanticDigest) ||
    !tracePattern.test(fact.traceId) ||
    (fact.actionsObserved !== null && fact.actionsObserved !== 0 && fact.actionsObserved !== 1) ||
    (fact.inboundCallCount !== null &&
      (!Number.isSafeInteger(fact.inboundCallCount) || fact.inboundCallCount < 0))
  ) {
    throw ApplicationError.validation("live_provider_fact_invalid");
  }
  return instant(fact.occurredAt);
}

function equivalent(
  record: {
    readonly providerCallDigest: string;
    readonly semanticDigest: string;
    readonly outcome: string;
    readonly occurredAt: Date;
    readonly traceId: string;
    readonly signatureValidated: boolean;
    readonly actionsObserved: number | null;
    readonly inboundCallCount: number | null;
  },
  fact: LiveSimulatorProviderFact,
): boolean {
  return (
    record.providerCallDigest === fact.providerCallDigest &&
    record.semanticDigest === fact.semanticDigest &&
    record.outcome === fact.outcome &&
    record.signatureValidated === fact.signatureValidated &&
    record.actionsObserved === fact.actionsObserved &&
    record.inboundCallCount === fact.inboundCallCount
  );
}

export class PrismaLiveSimulatorProviderFactRepository implements LiveSimulatorProviderFactRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async append(fact: LiveSimulatorProviderFact) {
    const occurredAt = validate(fact);
    try {
      await this.client.liveSimulatorProviderFact.create({
        data: {
          organizationId: fact.organizationId.value,
          operationId: fact.operationId,
          phase: fact.phase,
          providerCallDigest: fact.providerCallDigest,
          semanticDigest: fact.semanticDigest,
          outcome: fact.outcome,
          occurredAt,
          traceId: fact.traceId,
          signatureValidated: fact.signatureValidated,
          actionsObserved: fact.actionsObserved,
          inboundCallCount: fact.inboundCallCount,
        },
      });
      return Object.freeze({ outcome: "appended" as const });
    } catch {
      try {
        const established = await this.client.liveSimulatorProviderFact.findUnique({
          where: {
            organizationId_operationId_phase: {
              organizationId: fact.organizationId.value,
              operationId: fact.operationId,
              phase: fact.phase,
            },
          },
        });
        if (established !== null && equivalent(established, fact)) {
          return Object.freeze({ outcome: "replayed" as const });
        }
        if (established !== null) {
          throw ApplicationError.idempotencyConflict("live_provider_fact_conflict");
        }
      } catch (error: unknown) {
        if (error instanceof ApplicationError) throw error;
      }
      throw ApplicationError.dependencyUnavailable("live_provider_fact_repository_unavailable");
    }
  }

  public async listForOperation(organizationId: OrganizationId, operationId: string) {
    if (!operationPattern.test(operationId)) {
      throw ApplicationError.validation("live_provider_fact_invalid");
    }
    try {
      const records = await this.client.liveSimulatorProviderFact.findMany({
        where: { organizationId: organizationId.value, operationId },
        orderBy: [{ appendOrdinal: "asc" }],
      });
      return Object.freeze(
        records.map((record) =>
          Object.freeze({
            organizationId: OrganizationId.create(record.organizationId),
            operationId: record.operationId,
            phase: record.phase as LiveSimulatorProviderFact["phase"],
            providerCallDigest: record.providerCallDigest,
            semanticDigest: record.semanticDigest,
            outcome: record.outcome as LiveSimulatorProviderFact["outcome"],
            occurredAt: record.occurredAt.toISOString(),
            traceId: record.traceId,
            signatureValidated: record.signatureValidated,
            actionsObserved: record.actionsObserved as 0 | 1 | null,
            inboundCallCount: record.inboundCallCount,
            appendOrdinal: Number(record.appendOrdinal),
          }),
        ),
      );
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw ApplicationError.dependencyUnavailable("live_provider_fact_repository_unavailable");
    }
  }
}

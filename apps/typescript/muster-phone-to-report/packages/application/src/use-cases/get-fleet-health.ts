import {
  FLEET_HEALTH_CONTRACT_VERSION,
  type FleetHealthResponse,
  type FleetIncident,
  type FleetSchedulerHeartbeat,
} from "@muster/contracts";
import { deriveEndpointOperationalState, type OrganizationId } from "@muster/domain";

import { ApplicationError } from "../errors/application-error.js";
import type { Clock } from "../ports/clock.port.js";
import type { FleetHealthRepository } from "../ports/fleet-health.repository.js";
import type { FleetIncidentSummaryPort } from "../ports/fleet-incident-summary.port.js";
import type {
  SchedulerHeartbeatFact,
  SchedulerHeartbeatPort,
} from "../ports/scheduler-heartbeat.port.js";

declare const URL: {
  new (
    input: string,
    base?: string,
  ): {
    readonly origin: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  };
};

export interface GetFleetHealthDependencies {
  readonly fleetHealthRepository: FleetHealthRepository;
  readonly schedulerHeartbeat: SchedulerHeartbeatPort;
  readonly incidentSummaries: FleetIncidentSummaryPort;
  readonly clock: Clock;
  readonly heartbeatMaxAgeSeconds: number;
}

const unavailableIncident: FleetIncident = Object.freeze({ status: "unavailable" });

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validDisplayName(value: string | null): string | null {
  return value !== null && value.length >= 1 && value.length <= 160 && value.trim() === value
    ? value
    : null;
}

function parseCanonicalInstant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function validDetailPath(value: string): boolean {
  if (value.length < 1 || value.length > 512 || !value.startsWith("/") || value.startsWith("//"))
    return false;
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
  if (value.includes("\\") || hasControlCharacter || /%(?:2f|5c)/iu.test(value)) return false;
  try {
    // Resolve against a fixed origin so alternate origins, normalized dot segments, and suffixes
    // cannot turn an incident-owned relative path into an external or ambiguous navigation target.
    const origin = "https://fleet.invalid";
    const resolved = new URL(value, origin);
    return (
      resolved.origin === origin &&
      resolved.pathname === value &&
      resolved.search === "" &&
      resolved.hash === ""
    );
  } catch {
    return false;
  }
}

interface RuntimeIncidentRecord {
  readonly [key: string]: unknown;
  readonly status?: unknown;
  readonly incidentId?: unknown;
  readonly displayLabel?: unknown;
  readonly openedAt?: unknown;
  readonly detailPath?: unknown;
}

function isRecord(value: unknown): value is RuntimeIncidentRecord {
  return typeof value === "object" && value !== null;
}

function projectIncident(value: unknown): FleetIncident | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === "none") return Object.freeze({ status: "none" });
  if (value.status === "unavailable") return unavailableIncident;
  if (
    value.status !== "open" ||
    typeof value.incidentId !== "string" ||
    typeof value.displayLabel !== "string" ||
    typeof value.openedAt !== "string" ||
    typeof value.detailPath !== "string" ||
    value.incidentId.length < 1 ||
    value.incidentId.length > 128 ||
    value.incidentId.trim() !== value.incidentId ||
    value.displayLabel.length < 1 ||
    value.displayLabel.length > 160 ||
    value.displayLabel.trim() !== value.displayLabel ||
    parseCanonicalInstant(value.openedAt) === undefined ||
    !validDetailPath(value.detailPath)
  )
    return undefined;
  return Object.freeze({
    status: "open",
    incidentId: value.incidentId,
    displayLabel: value.displayLabel,
    openedAt: value.openedAt,
    detailPath: value.detailPath,
  });
}

function unavailableHeartbeat(): FleetSchedulerHeartbeat {
  return Object.freeze({
    status: "unavailable",
    observedAt: null,
    checkOutcome: null,
    evidenceKind: "foundation_health_job_completion",
  });
}

function projectHeartbeat(
  fact: SchedulerHeartbeatFact | null,
  now: string,
  maxAgeSeconds: number,
): FleetSchedulerHeartbeat {
  if (fact === null) {
    return Object.freeze({
      status: "missing",
      observedAt: null,
      checkOutcome: null,
      evidenceKind: "foundation_health_job_completion",
    });
  }
  const nowTime = parseCanonicalInstant(now);
  const observedAt = parseCanonicalInstant(fact.observedAt);
  if (
    nowTime === undefined ||
    observedAt === undefined ||
    observedAt > nowTime ||
    !Number.isInteger(maxAgeSeconds) ||
    maxAgeSeconds < 60 ||
    maxAgeSeconds > 86_400
  ) {
    return unavailableHeartbeat();
  }
  return Object.freeze({
    status: nowTime >= observedAt + maxAgeSeconds * 1_000 ? "stale" : "current",
    observedAt: fact.observedAt,
    checkOutcome: fact.checkOutcome,
    evidenceKind: "foundation_health_job_completion",
  });
}

export class GetFleetHealth {
  public constructor(private readonly dependencies: GetFleetHealthDependencies) {}

  public async execute(organizationId: OrganizationId): Promise<FleetHealthResponse> {
    const generatedAt = this.dependencies.clock.now();
    if (parseCanonicalInstant(generatedAt) === undefined) throw ApplicationError.unexpected();
    const facts = await this.dependencies.fleetHealthRepository.listFacts(organizationId);
    const endpointIds = facts
      .filter((fact) => fact.provenance !== "SIMULATED")
      .map((fact) => fact.endpointId);
    const [heartbeatResult, incidentResult] = await Promise.allSettled([
      this.dependencies.schedulerHeartbeat.readLatest(organizationId),
      this.dependencies.incidentSummaries.listForEndpoints(organizationId, endpointIds),
    ]);
    const heartbeat =
      heartbeatResult.status === "fulfilled"
        ? projectHeartbeat(
            heartbeatResult.value,
            generatedAt,
            this.dependencies.heartbeatMaxAgeSeconds,
          )
        : unavailableHeartbeat();
    const incidents = new Map<string, FleetIncident>();
    if (incidentResult.status === "fulfilled") {
      for (const summary of incidentResult.value) {
        const incident = projectIncident(summary.incident);
        if (
          endpointIds.includes(summary.endpointId) &&
          !incidents.has(summary.endpointId) &&
          incident !== undefined
        ) {
          incidents.set(summary.endpointId, incident);
        }
      }
    }

    const endpoints = facts
      .map((fact) => {
        const simulated = fact.provenance === "SIMULATED";
        const decision = deriveEndpointOperationalState({
          now: generatedAt,
          freshnessWindowSeconds: fact.freshnessWindowSeconds,
          lastCompleteObservation: simulated ? null : fact.lastCompleteObservation,
          latestTerminalAttempt: simulated ? null : fact.latestTerminalAttempt,
        });
        const completeObservation = fact.lastCompleteObservation;
        return Object.freeze({
          endpointId: fact.endpointId,
          siteDisplayName: validDisplayName(fact.siteDisplayName),
          endpointDisplayName: validDisplayName(fact.endpointDisplayName),
          provenance: fact.provenance,
          operationalState: decision.operationalState,
          freshness: decision.freshness,
          lastAttempt: fact.lastAttempt,
          lastCompleteObservation:
            completeObservation === null
              ? null
              : Object.freeze({
                  observationId: completeObservation.observationId,
                  operationId: completeObservation.operationId,
                  version: completeObservation.version,
                  observedAt: completeObservation.observedAt,
                  completedAt: completeObservation.completedAt,
                  provenance: completeObservation.provenance,
                  evidenceId: completeObservation.evidenceId,
                  adapterVersionId: completeObservation.adapterVersionId,
                  extractorVersionId: completeObservation.extractorVersionId,
                  reconciliationPolicyVersion: completeObservation.reconciliationPolicyVersion,
                }),
          activeManualOperation: fact.activeManualOperation,
          incident: simulated
            ? unavailableIncident
            : (incidents.get(fact.endpointId) ?? unavailableIncident),
        });
      })
      .sort(
        (left, right) =>
          codeUnitCompare(left.siteDisplayName ?? "", right.siteDisplayName ?? "") ||
          codeUnitCompare(left.endpointDisplayName ?? "", right.endpointDisplayName ?? "") ||
          codeUnitCompare(left.endpointId, right.endpointId),
      );

    return Object.freeze({
      contractVersion: FLEET_HEALTH_CONTRACT_VERSION,
      generatedAt,
      schedulerHeartbeat: heartbeat,
      endpoints,
    });
  }
}

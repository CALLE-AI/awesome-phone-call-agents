import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import {
  ApplicationError,
  GetFleetHealth,
  GetObservationOperation,
  RecordObservationResult,
  RequestObservation,
  StartObservationCall,
  type ObservationOperationResponse,
  type VoiceCallPort,
  type VoiceCallPortFactory,
  type VoiceCallRequest,
  type VoiceCallResult,
} from "@muster/application";
import { createMusterApiClient, type MusterApiClient } from "@muster/api-client";
import { EndpointObservationProfile, OrganizationId } from "@muster/domain";
import { ObservationJobHandler, createPgBossJobInfrastructure } from "@muster/infrastructure-jobs";
import {
  FakeVoiceCallPort,
  deployMigrations,
  getPostgresTestConnectionUrls,
  setupPostgresTestContainer,
} from "@muster/testing";
import { startSystemHealthHttpRuntime } from "@muster/api";
import { createWorkerPostgresBinding } from "@muster/worker";

export type FleetHealthTestScenario =
  | "complete"
  | "provider_failure_after_complete"
  | "admission_conflict_after_complete"
  | "admission_dependency_unavailable_after_complete"
  | "state_matrix";

export type FleetHealthTestHeartbeatState = "current" | "missing" | "stale" | "unavailable";

export interface FleetHealthTestRuntime {
  readonly baseUrl: string;
  readonly client: MusterApiClient;
  readonly endpointId: string;
  readonly organizationId: OrganizationId;
  readonly seededCompleteOperationId: string | null;
  releaseManualTerminal(): void;
  waitForTerminal(operationId: string): Promise<ObservationOperationResponse>;
  close(): Promise<void>;
}

export interface FleetHealthTestPostgres {
  readonly connectionString: string;
  close(): Promise<void>;
}

type ProviderStep =
  | Readonly<{ kind: "fixture"; fixtureIndex: number; deferred: boolean }>
  | Readonly<{ kind: "result"; result: VoiceCallResult; deferred: boolean }>;

class DeferredProviderSequence implements VoiceCallPortFactory {
  private readonly steps: ProviderStep[];
  private releaseDeferred: (() => void) | undefined;
  private released = false;

  public constructor(steps: readonly ProviderStep[]) {
    this.steps = [...steps];
  }

  public create(): VoiceCallPort {
    const step = this.steps.shift();
    if (step === undefined) throw new Error("No deterministic provider step remains");
    const delegate =
      step.kind === "fixture"
        ? new FakeVoiceCallPort({ fixtureIndexes: [step.fixtureIndex] })
        : new FakeVoiceCallPort(step.result);
    return {
      createOrReconcile: async (request: VoiceCallRequest): Promise<VoiceCallResult> => {
        if (step.deferred && !this.released) {
          await new Promise<void>((resolve) => {
            this.releaseDeferred = resolve;
          });
        }
        return await delegate.createOrReconcile(request);
      },
    };
  }

  public release(): void {
    this.released = true;
    this.releaseDeferred?.();
    this.releaseDeferred = undefined;
  }
}

function nextClock(): { now(): string } {
  let tick = 0;
  const epoch = Date.parse("2026-08-08T22:00:00.000Z");
  return { now: () => new Date(epoch + tick++ * 1_000).toISOString() };
}

function profile(organizationId: OrganizationId, endpointId: string): EndpointObservationProfile {
  return EndpointObservationProfile.create({
    endpointId,
    organizationId,
    adapterVersionId: "adapter_version_simulated_v1",
    expectedZones: [
      {
        zoneId: "zone-01",
        ordinal: 0,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: [
          {
            ruleId: "unit_rule_fahrenheit_v1",
            spokenUnit: "degrees fahrenheit",
            normalizedUnit: "degF",
          },
        ],
      },
      {
        zoneId: "zone-02",
        ordinal: 1,
        applicability: "required",
        requiredFacet: "measurement",
        allowedUnitMappings: [
          {
            ruleId: "unit_rule_fahrenheit_v1",
            spokenUnit: "degrees fahrenheit",
            normalizedUnit: "degF",
          },
        ],
      },
    ],
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: `authorization_${endpointId}`,
  });
}

async function waitForTerminal(
  client: MusterApiClient,
  operationId: string,
  timeoutMs = 15_000,
): Promise<ObservationOperationResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.getObservationOperation(operationId);
    if (result.ok && result.data.terminal) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for terminal Fleet Health observation");
}

export async function startFleetHealthTestPostgres(): Promise<FleetHealthTestPostgres> {
  const previousNodeEnvironment = process.env["NODE_ENV"];
  const previousVitest = process.env["VITEST"];
  process.env["NODE_ENV"] = "test";
  process.env["VITEST"] = "true";
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = await setupPostgresTestContainer();
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    return {
      connectionString,
      close: async () => {
        try {
          await stop?.();
        } finally {
          if (previousNodeEnvironment === undefined) delete process.env["NODE_ENV"];
          else process.env["NODE_ENV"] = previousNodeEnvironment;
          if (previousVitest === undefined) delete process.env["VITEST"];
          else process.env["VITEST"] = previousVitest;
        }
      },
    };
  } catch (error: unknown) {
    if (previousNodeEnvironment === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = previousNodeEnvironment;
    if (previousVitest === undefined) delete process.env["VITEST"];
    else process.env["VITEST"] = previousVitest;
    throw error;
  }
}

export async function createFleetHealthTestRuntime(input: {
  readonly connectionString: string;
  readonly scenario: FleetHealthTestScenario;
  readonly deferManualTerminal?: boolean;
  readonly heartbeatState?: FleetHealthTestHeartbeatState;
  readonly staleEndpoint?: boolean;
}): Promise<FleetHealthTestRuntime> {
  await deployMigrations(input.connectionString);
  const organizationId = OrganizationId.create(`org_fleet_e2e_${randomUUID()}`);
  const endpointId = `endpoint_fleet_e2e_${randomUUID()}`;
  const sql = new Pool({ connectionString: input.connectionString });
  const postgres = createWorkerPostgresBinding(input.connectionString);
  const jobs = createPgBossJobInfrastructure({
    connectionString: input.connectionString,
    schema: `pgboss_fleet_e2e_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    retryDelaySeconds: 0,
  });
  const needsCompleteSeed = input.scenario !== "complete";
  const providerSteps: ProviderStep[] = needsCompleteSeed
    ? [{ kind: "fixture", fixtureIndex: 0, deferred: false }]
    : [{ kind: "fixture", fixtureIndex: 0, deferred: input.deferManualTerminal ?? false }];
  if (input.scenario === "provider_failure_after_complete") {
    providerSteps.push({
      kind: "result",
      result: {
        kind: "terminal_failure",
        outcome: "provider_failed",
        retryable: true,
      },
      deferred: input.deferManualTerminal ?? false,
    });
  }
  const provider = new DeferredProviderSequence(providerSteps);
  const clock = nextClock();
  const identifiers = { generate: randomUUID };
  let http: Awaited<ReturnType<typeof startSystemHealthHttpRuntime>> | undefined;
  let closed = false;
  try {
    await postgres.observationProfiles.establish(profile(organizationId, endpointId));
    await sql.query(
      "UPDATE endpoints SET site_display_name = $1, endpoint_display_name = $2, freshness_window_seconds = $3 WHERE organization_id = $4 AND id = $5",
      [
        "North campus",
        "Boiler room monitor",
        input.staleEndpoint === true ? 60 : 2_592_000,
        organizationId.value,
        endpointId,
      ],
    );
    const heartbeatState = input.heartbeatState ?? "current";
    if (heartbeatState === "current" || heartbeatState === "stale") {
      await sql.query(
        "INSERT INTO audit_events (organization_id, id, kind, occurred_at, correlation_id, idempotency_key, outcome) VALUES ($1, $2, 'foundation.health.checked', $3, $2, $2, 'ready')",
        [
          organizationId.value,
          `heartbeat_${randomUUID()}`,
          heartbeatState === "current" ? "2026-08-08T22:09:30.000Z" : "2026-08-08T21:00:00.000Z",
        ],
      );
    }

    const recordResult = new RecordObservationResult({
      attempts: postgres.callAttempts,
      profiles: postgres.observationProfiles,
      evidence: postgres.evidence,
      observations: postgres.observations,
      clock,
      identifiers,
    });
    const startObservationCall = new StartObservationCall({
      attempts: postgres.callAttempts,
      profiles: postgres.observationProfiles,
      policy: { evaluate: async () => ({ outcome: "allowed" }) },
      providerFactory: provider,
      clock,
      recordResult,
    });
    const requestObservation = new RequestObservation({
      profiles: postgres.observationProfiles,
      attempts: postgres.callAttempts,
      scheduler: jobs.scheduler,
      clock,
      identifiers,
    });
    const getObservationOperation = new GetObservationOperation({
      observations: postgres.observations,
    });
    const getFleetHealth = new GetFleetHealth({
      fleetHealthRepository: postgres.fleetHealth,
      schedulerHeartbeat:
        heartbeatState === "unavailable"
          ? {
              readLatest: async () => {
                throw ApplicationError.dependencyUnavailable("audit_repository_unavailable");
              },
            }
          : postgres.schedulerHeartbeat,
      incidentSummaries: { listForEndpoints: async () => [] },
      clock: { now: () => "2026-08-08T22:10:00.000Z" },
      heartbeatMaxAgeSeconds: 900,
    });
    const handler = new ObservationJobHandler(startObservationCall, {
      run: async (_payload, operation) => await operation(),
    });
    await jobs.start();
    await jobs.workObservation(async (payload, context) => {
      await handler.handle(payload, context);
    });

    let seededCompleteOperationId: string | null = null;
    if (needsCompleteSeed) {
      const seeded = await requestObservation.execute({
        organizationId,
        endpointId,
        idempotencyKey: `seed_complete_${randomUUID()}`,
        pollWindowId: `seed_complete_window_${randomUUID()}`,
        correlationId: randomUUID(),
        trigger: "manual",
      });
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const operation = await getObservationOperation.execute({
          organizationId,
          operationId: seeded.operation.id,
        });
        if (operation?.terminal === true) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const completed = await getObservationOperation.execute({
        organizationId,
        operationId: seeded.operation.id,
      });
      if (completed?.terminal !== true || completed.observation?.quality !== "complete") {
        throw new Error("Prior complete Fleet observation could not be seeded");
      }
      seededCompleteOperationId = seeded.operation.id;
    }

    const admissionRequest =
      input.scenario === "admission_conflict_after_complete"
        ? {
            execute: async (): Promise<never> => {
              throw ApplicationError.idempotencyConflict("call_attempt_idempotency_conflict");
            },
          }
        : input.scenario === "admission_dependency_unavailable_after_complete"
          ? {
              execute: async (): Promise<never> => {
                throw ApplicationError.dependencyUnavailable("observation_repository_unavailable");
              },
            }
          : requestObservation;

    http = await startSystemHealthHttpRuntime({
      connectionString: input.connectionString,
      jobsSchema: `pgboss_fleet_http_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      runtimeProfile: "test",
      healthExposure: "disabled",
      startJobs: false,
      observationRetryAfterSeconds: 1,
      fleetRetryAfterSeconds: 1,
      fleetRequestAuthorizer: async () => ({ organizationId }),
      fleet: {
        getFleetHealth,
        requestAuthorizer: async () => ({ organizationId }),
      },
      observation: {
        requestAuthorizer: async () => ({ organizationId }),
        requestObservation: admissionRequest,
        getObservationOperation,
      },
    });
    const client = createMusterApiClient({ baseUrl: http.baseUrl, authorization: "fleet-e2e" });

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      for (const operation of [
        async () => await http?.close(),
        async () => await jobs.stop(),
        async () => await postgres.close(),
        async () => await sql.end(),
      ]) {
        try {
          await operation();
        } catch (error: unknown) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, "Fleet Health test cleanup failed");
    };
    return {
      baseUrl: http.baseUrl,
      client,
      endpointId,
      organizationId,
      seededCompleteOperationId,
      releaseManualTerminal: () => provider.release(),
      waitForTerminal: async (operationId) => await waitForTerminal(client, operationId),
      close,
    };
  } catch (error: unknown) {
    await http?.close().catch(() => undefined);
    await jobs.stop().catch(() => undefined);
    await postgres.close().catch(() => undefined);
    await sql.end().catch(() => undefined);
    throw error;
  }
}

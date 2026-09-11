import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GetObservationOperation,
  RecordObservationResult,
  RecoverPendingObservationRequests,
  RequestObservation,
  StartObservationCall,
  type ObservationDispatchPolicyPort,
} from "@muster/application";
import { createMusterApiClient, type MusterApiClient } from "@muster/api-client";
import { EndpointObservationProfile, OrganizationId } from "@muster/domain";
import {
  ObservationJobHandler,
  createPgBossJobInfrastructure,
  type PgBossJobInfrastructure,
} from "@muster/infrastructure-jobs";
import {
  createInMemoryObservationHttpMetrics,
  type ObservationHttpMetricInput,
} from "@muster/observability";
import {
  FakeVoiceCallPortFactory,
  OBSERVATION_REVIEWED_ORACLE,
  deployMigrations,
  getPostgresTestConnectionUrls,
  hasMigrationDrift,
} from "@muster/testing";

import { startSystemHealthHttpRuntime } from "../../apps/api/src/composition/start-system-health-http-runtime.js";
import { createWorkerPostgresBinding } from "../../apps/worker/src/composition/create-worker-postgres.js";
import { analyzeArchitectureSource } from "../../tools/architecture/architecture-policy.js";
import { checkGeneratedClient } from "../../tools/openapi/check-generated-client.js";

/**
 * Test strategy: four cross-cutting cases exercise only Muster-owned behavior at the generated
 * client, real HTTP, pg-boss, worker, Prisma/PostgreSQL, provider-port, observability, and drift
 * boundaries. What is deliberately not tested: real devices/providers, CALL-E behavior,
 * production cadence/SLOs, Fleet UI, deployment, or third-party library internals.
 */

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const traceContext = Object.freeze({
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  tracestate: "muster=observation-phase5",
});

interface WorkflowHarness {
  readonly organizationId: OrganizationId;
  readonly endpointId: string;
  readonly jobs: PgBossJobInfrastructure;
  readonly provider: FakeVoiceCallPortFactory;
  readonly requestObservation: RequestObservation;
  readonly getObservationOperation: GetObservationOperation;
  readonly recoverPending: RecoverPendingObservationRequests;
  readonly handler: ObservationJobHandler;
  readonly startWorker: () => Promise<void>;
}

interface ObservationPollingGuidance {
  readonly retryAfterSeconds: number;
}

async function parseObservationPollingGuidance(
  environment: Record<string, string | undefined>,
): Promise<ObservationPollingGuidance> {
  const loaded = (await import("../../apps/api/src/config/configuration.js")) as Record<
    string,
    unknown
  >;
  const parser = loaded["parseObservationPollingGuidance"];
  if (typeof parser !== "function") {
    throw new Error("Phase 5 observation polling configuration is not implemented");
  }
  return (parser as (input: Record<string, string | undefined>) => ObservationPollingGuidance)(
    environment,
  );
}

const closers: Array<() => Promise<void>> = [];
let connectionString = "";

function nextClock(): { now(): string } {
  let tick = 0;
  const epoch = Date.parse("2026-08-06T20:00:00.000Z");
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

async function createWorkflow(input: {
  readonly fixtureIndexes?: readonly number[];
  readonly providerFailure?: Readonly<{
    kind: "terminal_failure";
    outcome: "provider_failed";
    retryable: boolean;
  }>;
  readonly policy?: ObservationDispatchPolicyPort;
  readonly schema?: string;
  readonly endpointId?: string;
}): Promise<WorkflowHarness> {
  const organizationId = OrganizationId.create(`org_phase5_${randomUUID()}`);
  const endpointId = input.endpointId ?? `endpoint_phase5_${randomUUID()}`;
  const postgres = createWorkerPostgresBinding(connectionString);
  closers.push(async () => await postgres.close());
  await postgres.observationProfiles.establish(profile(organizationId, endpointId));
  const jobs = createPgBossJobInfrastructure({
    connectionString,
    schema: input.schema ?? `pgboss_phase5_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    retryDelaySeconds: 0,
    activeTraceContext: () => traceContext,
  });
  closers.push(async () => await jobs.stop());
  const clock = nextClock();
  const identifiers = { generate: randomUUID };
  const provider = new FakeVoiceCallPortFactory(
    input.providerFailure ?? { fixtureIndexes: input.fixtureIndexes ?? [0] },
  );
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
    policy: input.policy ?? { evaluate: async () => ({ outcome: "allowed" }) },
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
  const recoverPending = new RecoverPendingObservationRequests({
    attempts: postgres.callAttempts,
    scheduler: jobs.scheduler,
    identifiers,
  });
  const observedTraceContexts: string[] = [];
  const handler = new ObservationJobHandler(startObservationCall, {
    run: async (payload, operation) => {
      if (payload.traceContext?.traceparent !== undefined) {
        observedTraceContexts.push(payload.traceContext.traceparent);
      }
      return await operation();
    },
  });
  return {
    organizationId,
    endpointId,
    jobs,
    provider,
    requestObservation,
    getObservationOperation,
    recoverPending,
    handler,
    startWorker: async () => {
      await jobs.start();
      await jobs.workObservation(async (payload, context) => {
        await handler.handle(payload, context);
      });
    },
  };
}

async function waitForTerminal(client: MusterApiClient, operationId: string, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.getObservationOperation(operationId);
    if (result.ok && result.data.terminal) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for terminal observation operation");
}

beforeEach(async () => {
  connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
});

afterEach(async () => {
  const errors: unknown[] = [];
  for (const close of closers.splice(0).reverse()) {
    try {
      await close();
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Observation E2E cleanup failed");
});

describe.sequential("evidence-backed observation entry-to-terminal flow", () => {
  it("drives generated-client manual ingress to evidence-specific terminal readings", async () => {
    const workflow = await createWorkflow({ fixtureIndexes: [0] });
    await workflow.startWorker();
    const logEvents: unknown[] = [];
    const metricInputs: ObservationHttpMetricInput[] = [];
    const inMemoryMetrics = createInMemoryObservationHttpMetrics();
    const logger = {
      debug: () => undefined,
      info: (event: unknown) => logEvents.push(event),
      warn: () => undefined,
      error: () => undefined,
      child: () => logger,
    };
    const polling = await parseObservationPollingGuidance({
      OBSERVATION_RETRY_AFTER_SECONDS: "7",
    });
    const http = await startSystemHealthHttpRuntime({
      connectionString,
      jobsSchema: `pgboss_phase5_http_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      runtimeProfile: "test",
      healthExposure: "disabled",
      startJobs: false,
      observationRetryAfterSeconds: polling.retryAfterSeconds,
      observation: {
        requestAuthorizer: async () => ({ organizationId: workflow.organizationId }),
        requestObservation: workflow.requestObservation,
        getObservationOperation: workflow.getObservationOperation,
        logger,
        telemetry: {
          run: async ({ operation }) => await operation(),
          activeTraceContext: () => traceContext,
          recordRequest: (metric) => {
            metricInputs.push(metric);
            inMemoryMetrics.metrics.recordRequest(metric);
          },
        },
      },
    });
    closers.push(async () => await http.close());
    const client = createMusterApiClient({ baseUrl: http.baseUrl, authorization: "phase5-test" });

    const accepted = await client.requestObservation({
      endpointId: workflow.endpointId,
      idempotencyKey: "manual_phase5_idempotency",
      pollWindowId: "poll_window_phase5_manual",
    });
    expect(accepted).toMatchObject({
      ok: true,
      status: 202,
      headers: { retryAfterSeconds: 7 },
    });
    if (!accepted.ok) throw new Error("Manual observation was not accepted");
    const terminal = await waitForTerminal(client, accepted.data.operationId);
    if (!terminal.ok) throw new Error("Manual observation status failed");
    const oracle = OBSERVATION_REVIEWED_ORACLE[0];

    expect(terminal.data).toMatchObject({
      stage: "terminal",
      terminal: true,
      terminalOutcome: "observation_recorded",
      attempt: { trigger: "manual", provenance: "SIMULATED" },
      evidence: { provenance: "SIMULATED" },
      observation: {
        version: 1,
        quality: oracle?.quality,
        provenance: "SIMULATED",
      },
    });
    expect(terminal.data.observation?.readings.map((reading) => reading.value)).toEqual(
      oracle?.values,
    );
    expect(terminal.data.observation?.readings.map((reading) => reading.disposition)).toEqual(
      oracle?.dispositions,
    );
    expect(
      terminal.data.observation?.readings.every(
        (reading) => reading.evidenceId === terminal.data.evidence?.evidenceId,
      ),
    ).toBe(true);
    expect(workflow.provider.constructionCount).toBe(1);
    expect(workflow.provider.port.dispatches).toHaveLength(1);
    expect(workflow.provider.port.dispatches[0]?.traceContext).toEqual(traceContext);
    expect(metricInputs.map(({ outcome }) => outcome)).toContain("accepted");
    expect(metricInputs.map(({ outcome }) => outcome)).toContain("found");
    expect(
      inMemoryMetrics
        .snapshot()
        .every(
          ({ attributes }) =>
            !JSON.stringify(attributes).match(/org_|endpoint_|provider|evidence/iu),
        ),
    ).toBe(true);
    expect(JSON.stringify(logEvents)).not.toMatch(
      /org_phase5|endpoint_phase5|provider|custody|transcript/iu,
    );
  }, 25_000);

  it("preserves scheduled identity and one provider dispatch across queue restart and replay", async () => {
    const schema = `pgboss_phase5_restart_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const workflow = await createWorkflow({ fixtureIndexes: [1], schema });
    await workflow.jobs.start();
    const request = {
      organizationId: workflow.organizationId,
      endpointId: workflow.endpointId,
      pollWindowId: "poll_window_phase5_scheduled",
      idempotencyKey: "scheduled_phase5_idempotency",
      correlationId: "scheduled_phase5_correlation",
      trigger: "scheduled" as const,
      traceContext,
    };
    const first = await workflow.requestObservation.execute(request);
    const replay = await workflow.requestObservation.execute(request);

    expect(replay.operation.id).toBe(first.operation.id);
    expect(replay.operation.acceptedAt).toBe(first.operation.acceptedAt);
    expect(replay).toMatchObject({ outcome: "replayed", schedulingOutcome: "duplicate" });
    await workflow.jobs.stop();
    const restartedJobs = createPgBossJobInfrastructure({
      connectionString,
      schema,
      retryDelaySeconds: 0,
      activeTraceContext: () => traceContext,
    });
    closers.push(async () => await restartedJobs.stop());
    await restartedJobs.start();
    await restartedJobs.workObservation(async (payload, context) => {
      await workflow.handler.handle(payload, context);
    });

    const deadline = Date.now() + 12_000;
    let terminal = await workflow.getObservationOperation.execute({
      organizationId: workflow.organizationId,
      operationId: first.operation.id,
    });
    while (terminal?.terminal !== true && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      terminal = await workflow.getObservationOperation.execute({
        organizationId: workflow.organizationId,
        operationId: first.operation.id,
      });
    }

    expect(terminal).toMatchObject({
      stage: "terminal",
      terminalOutcome: "observation_recorded",
      attempt: { trigger: "scheduled", provenance: "SIMULATED" },
      observation: { quality: "complete", provenance: "SIMULATED" },
    });
    const scheduledValues = terminal?.observation?.readings.map((reading) => reading.value);
    expect(scheduledValues).toEqual(OBSERVATION_REVIEWED_ORACLE[1]?.values);
    expect(scheduledValues).not.toEqual(OBSERVATION_REVIEWED_ORACLE[0]?.values);
    const recovery = await workflow.recoverPending.execute({ limit: 10, traceContext });
    expect(recovery).toMatchObject({
      scheduled: 0,
      duplicates: 0,
    });
    expect(recovery.examined).toBe(recovery.deferred);
    expect(workflow.provider.port.dispatches).toHaveLength(1);
    expect(workflow.provider.constructionCount).toBe(1);
  }, 25_000);

  it("persists provider failure and safety block as terminal operations with no observation", async () => {
    const providerFailure = await createWorkflow({
      providerFailure: { kind: "terminal_failure", outcome: "provider_failed", retryable: true },
    });
    await providerFailure.startWorker();
    const failure = await providerFailure.requestObservation.execute({
      organizationId: providerFailure.organizationId,
      endpointId: providerFailure.endpointId,
      pollWindowId: "poll_window_phase5_failure",
      idempotencyKey: "failure_phase5_idempotency",
      correlationId: "failure_phase5_correlation",
      trigger: "manual",
      traceContext,
    });
    const failureDeadline = Date.now() + 12_000;
    let failureProjection = await providerFailure.getObservationOperation.execute({
      organizationId: providerFailure.organizationId,
      operationId: failure.operation.id,
    });
    while (failureProjection?.terminal !== true && Date.now() < failureDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      failureProjection = await providerFailure.getObservationOperation.execute({
        organizationId: providerFailure.organizationId,
        operationId: failure.operation.id,
      });
    }

    expect(failureProjection).toMatchObject({
      stage: "terminal",
      terminalOutcome: "provider_failed",
      attempt: { retryable: true, provenance: "SIMULATED" },
      evidence: null,
      observation: null,
      recommendedAction: "create_new_request_after_remediation",
    });

    const blocked = await createWorkflow({
      policy: {
        evaluate: async () => ({ outcome: "blocked", reason: "provider_binding_unapproved" }),
      },
    });
    await blocked.startWorker();
    const block = await blocked.requestObservation.execute({
      organizationId: blocked.organizationId,
      endpointId: blocked.endpointId,
      pollWindowId: "poll_window_phase5_block",
      idempotencyKey: "block_phase5_idempotency",
      correlationId: "block_phase5_correlation",
      trigger: "scheduled",
      traceContext,
    });
    const blockDeadline = Date.now() + 12_000;
    let blockProjection = await blocked.getObservationOperation.execute({
      organizationId: blocked.organizationId,
      operationId: block.operation.id,
    });
    while (blockProjection?.terminal !== true && Date.now() < blockDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      blockProjection = await blocked.getObservationOperation.execute({
        organizationId: blocked.organizationId,
        operationId: block.operation.id,
      });
    }
    expect(blockProjection).toMatchObject({
      stage: "terminal",
      terminalOutcome: "blocked",
      evidence: null,
      observation: null,
    });
    expect(blocked.provider.constructionCount).toBe(0);
    expect(blocked.provider.port.dispatches).toHaveLength(0);
  }, 35_000);

  it("proves disposable boundary and drift mutations plus explicit later-feature handoffs", async () => {
    expect(
      analyzeArchitectureSource({
        filePath: "packages/application/src/phase5-mutation.ts",
        source: 'import "@muster/infrastructure-postgres";',
      }).map(({ code }) => code),
    ).toContain("architecture/dependency-direction");
    await expect(
      parseObservationPollingGuidance({ OBSERVATION_RETRY_AFTER_SECONDS: "1" }),
    ).resolves.toEqual({
      retryAfterSeconds: 1,
    });
    await expect(
      parseObservationPollingGuidance({ OBSERVATION_RETRY_AFTER_SECONDS: "0" }),
    ).rejects.toThrow(/OBSERVATION_RETRY_AFTER_SECONDS/u);
    await expect(
      parseObservationPollingGuidance({ OBSERVATION_RETRY_AFTER_SECONDS: "61" }),
    ).rejects.toThrow(/OBSERVATION_RETRY_AFTER_SECONDS/u);

    const temporaryRoot = await mkdtemp(join(tmpdir(), "muster-observation-phase5-drift-"));
    const committedGenerated = join(repositoryRoot, "packages/api-client/src/generated");
    const generatedTarget = join(temporaryRoot, "generated");
    const committedSchema = join(repositoryRoot, "prisma/schema.prisma");
    const prismaTarget = join(temporaryRoot, "schema.prisma");
    const generatedSchema = join(generatedTarget, "schema.ts");
    const committedGeneratedSource = await readFile(join(committedGenerated, "schema.ts"), "utf8");
    const committedPrismaSource = await readFile(committedSchema, "utf8");
    try {
      await cp(committedGenerated, generatedTarget, { recursive: true });
      await writeFile(generatedSchema, `${committedGeneratedSource}// phase5 drift\n`, "utf8");
      const driftedPrismaSource = committedPrismaSource.replace(
        /([ ]{2}outcome[ ]{8}AuditEventOutcome)(\r?\n)/u,
        '$1$2  phase5DriftProbe String? @map("phase5_drift_probe")$2',
      );
      expect(driftedPrismaSource).not.toBe(committedPrismaSource);
      await writeFile(prismaTarget, driftedPrismaSource, "utf8");

      expect(await checkGeneratedClient(generatedTarget)).toEqual({ valid: true, drift: true });
      expect(await hasMigrationDrift(connectionString, prismaTarget)).toBe(true);
      expect(await readFile(join(committedGenerated, "schema.ts"), "utf8")).toBe(
        committedGeneratedSource,
      );
      expect(await readFile(committedSchema, "utf8")).toBe(committedPrismaSource);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }

    const [adr, architecture, readme] = await Promise.all([
      readFile(
        join(repositoryRoot, "docs/adr/0003-evidence-backed-observation-workflow.md"),
        "utf8",
      ),
      readFile(join(repositoryRoot, "docs/architecture/evidence-backed-observation.md"), "utf8"),
      readFile(join(repositoryRoot, "README.md"), "utf8"),
    ]);
    const handoff = `${adr}\n${architecture}\n${readme}`;
    expect(handoff).toMatch(/observation: null/iu);
    expect(handoff).toMatch(/SIMULATED/u);
    expect(handoff).toMatch(/fleet-health-operations-view/iu);
    expect(handoff).toMatch(/OBSERVATION_RETRY_AFTER_SECONDS/u);
    expect(handoff).toMatch(/does not prove.*provider|no provider.*claim/iu);
    expect(handoff).not.toMatch(/production[- ]ready|hardware[- ]verified/iu);
  }, 35_000);
});

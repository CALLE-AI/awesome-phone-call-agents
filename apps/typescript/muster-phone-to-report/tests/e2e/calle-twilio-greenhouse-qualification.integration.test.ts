import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordObservationResult, RequestObservation } from "@muster/application";
import { EndpointObservationProfile, OrganizationId } from "@muster/domain";
import { createPostgresPersistence } from "@muster/infrastructure-postgres";
import {
  createDtmfSafetyStop,
  createLiveSmokeRunner,
  createLiveSmokeRunGate,
  mapCalleTerminalOutput,
} from "@muster/infrastructure-twilio-simulator";
import {
  authorizeLiveSimulatorRun,
  createAtomicLiveResultPersistence,
  createSimulatorHostCallAttemptBoundaries,
  startSimulatorHostRuntime,
} from "@muster/simulator-host";
import {
  deployMigrations,
  getPostgresTestConnectionUrls,
  SIMULATOR_SCENARIO_CATALOG,
} from "@muster/testing";

/*
 * Test Strategy
 * - Exercise the real loopback simulator-host, pg-boss, PostgreSQL repositories, signed callback
 *   boundary, and local custody store for the complete and result-free lifecycle paths.
 * - Use an independent SQL/count oracle for exact durable rows and mutation-sensitive ordering.
 * What I'm NOT Testing
 * - No external CALL-E/Twilio call, credential, phone value, tunnel, or production route participates.
 * - Browser presentation, cleanup of external resources, and the separately authorized live run
 *   remain Phase 5/6 work.
 */

const endpointAlias = "greenhouse-synthetic";
const authorizationAudience = "muster-live-simulator";
const publicBaseUrl = "https://simulator.invalid";
const signingKey = "phase-four-test-signing-key-with-at-least-32-bytes";
const twilioAuthToken = "phase-four-test-twilio-key";
const callbackIdentityHmacKey = "phase-four-callback-key-with-at-least-32-bytes";
const syntheticCaller = "+12025550117";
const syntheticTarget = "+12025550118";
const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

type CallbackMode = "complete" | "duplicate" | "mismatched_status" | "status_before_canary";

function identityDigest(value: string): string {
  return createHmac("sha256", callbackIdentityHmacKey).update(value, "utf8").digest("hex");
}

function twilioSignature(requestUrl: string, form: Readonly<Record<string, string>>): string {
  const signed = Object.keys(form)
    .sort()
    .reduce((value, key) => `${value}${key}${form[key] ?? ""}`, requestUrl);
  return createHmac("sha1", twilioAuthToken).update(signed, "utf8").digest("base64");
}

function providerOutput(input: {
  readonly operationId: string;
  readonly opaqueCustodyRef: string;
  readonly observedAt?: string;
  readonly invalidZone?: boolean;
  readonly omitTranscript?: boolean;
}) {
  const readings = [
    ["zone-01", "71.5", "degrees Fahrenheit", "degF"],
    ["zone-02", "68.0", "degrees Fahrenheit", "degF"],
    ["zone-03", "68", "percent", "percent"],
    [input.invalidZone === true ? "zone-05" : "zone-04", "82", "percent", "percent"],
  ] as const;
  return Object.freeze({
    providerCallId: `provider-${input.operationId}`,
    terminalStatus: "completed",
    observedAt: input.observedAt ?? new Date().toISOString(),
    evidence: Object.freeze({
      providerRevisionId: `revision-${input.operationId}`,
      opaqueCustodyRef: input.opaqueCustodyRef,
      sourceCompleteness: "complete",
      ...(input.omitTranscript === true
        ? {}
        : {
            transcript: Object.freeze(
              readings.map(([zoneId, value, spokenUnit]) =>
                Object.freeze({
                  speaker: "device" as const,
                  text: `${zoneId} reports ${value} ${spokenUnit}.`,
                }),
              ),
            ),
          }),
      readings: Object.freeze(
        readings.map(([zoneId, value, spokenUnit, normalizedUnit], index) =>
          Object.freeze({
            zoneId,
            value,
            spokenUnit,
            normalizedUnit,
            status: "OK" as const,
            confidenceToken: "provider-observed",
            sourceAnchor: Object.freeze({
              anchorId: `anchor-${String(index)}`,
              valueToken: value,
              spokenUnitToken: spokenUnit,
              opaqueSourceRef: `${input.opaqueCustodyRef}#turn=${String(index)}`,
            }),
          }),
        ),
      ),
      auxiliaryStatus: Object.freeze({
        sound: "normal" as const,
        power: "mains_available" as const,
        battery: "normal" as const,
        output: "off" as const,
      }),
    }),
  });
}

async function waitForTerminal(
  baseUrl: string,
  operationId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/live-simulator/operations/${operationId}`);
    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      if (body["terminal"] === true) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for terminal operation ${operationId}`);
}

async function rowCounts(pool: Pool, organizationId: OrganizationId, operationId: string) {
  const result = await pool.query<{
    evidence_count: number;
    observation_count: number;
    reading_count: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM evidence_records WHERE organization_id = $1 AND call_attempt_id = $2) AS evidence_count,
       (SELECT COUNT(*)::int FROM observations WHERE organization_id = $1 AND operation_id = $2) AS observation_count,
       (SELECT COUNT(*)::int FROM readings WHERE organization_id = $1 AND operation_id = $2) AS reading_count`,
    [organizationId.value, operationId],
  );
  return result.rows[0]!;
}

interface Harness {
  readonly operationId: string;
  readonly organizationId: OrganizationId;
  readonly pool: Pool;
  readonly persistence: ReturnType<typeof createPostgresPersistence>;
  readonly custodyRoot: string;
  readonly providerDispatch: ReturnType<typeof vi.fn>;
  readonly runtime: Awaited<ReturnType<typeof startSimulatorHostRuntime>>;
  readonly permit: string;
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const close of closers.splice(0).reverse()) await close();
});

async function createAtomicResultHarness(input: {
  readonly capturedAt: string;
  readonly localNow: string;
  readonly transactionMaxWaitMs?: number;
  readonly transactionTimeoutMs?: number;
}) {
  const connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
  const suffix = randomUUID().replaceAll("-", "");
  const organizationId = OrganizationId.create(`org-clock-skew-${suffix}`);
  const operationId = `operation-clock-skew-${suffix}`;
  const transactionTimeoutMs = input.transactionTimeoutMs ?? 4_000;
  const pool = new Pool({
    connectionString,
    max: 2,
    statement_timeout: transactionTimeoutMs,
    lock_timeout: transactionTimeoutMs,
  });
  const persistence = createPostgresPersistence(pool, {
    probeTimeoutMs: 500,
    ...(input.transactionMaxWaitMs === undefined
      ? {}
      : { observationResultTransactionMaxWaitMs: input.transactionMaxWaitMs }),
    ...(input.transactionTimeoutMs === undefined
      ? {}
      : { observationResultTransactionTimeoutMs: transactionTimeoutMs }),
  });
  closers.push(
    async () =>
      await Promise.allSettled([persistence.disconnect(), pool.end()]).then(() => undefined),
  );
  const profile = EndpointObservationProfile.create({
    endpointId: endpointAlias,
    organizationId,
    adapterVersionId: `adapter-clock-skew-${suffix}`,
    expectedZones: [
      ["zone-01", "degrees Fahrenheit", "degF"],
      ["zone-02", "degrees Fahrenheit", "degF"],
      ["zone-03", "percent", "percent"],
      ["zone-04", "percent", "percent"],
    ].map(([zoneId, spokenUnit, normalizedUnit], ordinal) => ({
      zoneId: zoneId!,
      ordinal,
      applicability: "required" as const,
      requiredFacet: "measurement" as const,
      allowedUnitMappings: [
        {
          ruleId: "calle-provider-observed.v1",
          spokenUnit: spokenUnit!,
          normalizedUnit: normalizedUnit!,
        },
      ],
    })),
    dtmfPolicy: { kind: "forbidden" },
    compatibility: "simulator-tested",
    provenance: "SIMULATED",
    authorizationReferenceId: "clock-skew-local-only",
  });
  await persistence.observationProfiles.establish(profile);
  const request = new RequestObservation({
    profiles: persistence.observationProfiles,
    attempts: persistence.callAttempts,
    scheduler: {
      scheduleObservation: async () => ({ outcome: "scheduled", jobId: "job-clock-skew" }),
    },
    clock: { now: () => "2026-08-26T20:00:00.000Z" },
    identifiers: { generate: () => operationId },
  });
  await request.execute({
    organizationId,
    endpointId: endpointAlias,
    pollWindowId: "synthetic-normal@2",
    idempotencyKey: `clock-skew:${operationId}`,
    correlationId: operationId,
    trigger: "manual",
  });
  await persistence.callAttempts.recordCalling({
    organizationId,
    operationId,
    transitionedAt: "2026-08-26T20:00:01.000Z",
  });
  const mapped = await mapCalleTerminalOutput(
    providerOutput({
      operationId,
      opaqueCustodyRef: "local-transcript://opaque-clock-skew",
      observedAt: input.capturedAt,
    }),
    { operationId, adapterVersionId: profile.adapterVersionId, simulationRunId: operationId },
    { reviewedConfidenceTokens: ["provider-observed"], persistAdmission: async () => undefined },
  );
  const resultPersistence = createAtomicLiveResultPersistence({
    organizationId,
    callAttempts: persistence.callAttempts,
    runObservationResultTransaction: persistence.runObservationResultTransaction,
    createRecordResult: (repositories) =>
      new RecordObservationResult({
        ...repositories,
        clock: { now: () => input.localNow },
        identifiers: { generate: randomUUID },
      }),
  });
  return { operationId, organizationId, pool, persistence, mapped, resultPersistence };
}

async function createHarness(input: {
  readonly callbackMode: CallbackMode;
  readonly invalidZone?: boolean;
  readonly omitTranscript?: boolean;
  readonly timeoutMs?: number;
}): Promise<Harness> {
  const connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
  const suffix = randomUUID().replaceAll("-", "");
  const operationId = `operation-phase4-${suffix}`;
  const organizationId = OrganizationId.create(`org-phase4-${suffix}`);
  const pool = new Pool({ connectionString, max: 3 });
  const persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });
  const custodyRoot = await mkdtemp(join(tmpdir(), "muster-phase4-custody-"));
  closers.push(async () => {
    await Promise.allSettled([persistence.disconnect(), pool.end()]);
    await rm(custodyRoot, { recursive: true, force: true });
  });

  const output: string[] = [];
  await authorizeLiveSimulatorRun({
    argv: ["--scenario", "synthetic-normal"],
    configuration: {
      organizationId: organizationId.value,
      endpointAlias,
      authorizationAudience,
      authorizationSigningKey: signingKey,
      authorizedTargetDigest: identityDigest(syntheticTarget),
      publicBaseUrl,
    },
    authorizationIssuer: persistence.liveSimulatorAuthorizations,
    predecessorLookup: { find: async () => undefined },
    scenarios: SIMULATOR_SCENARIO_CATALOG,
    generateOperationId: () => operationId,
    generateNonce: () => `nonce-${operationId}`,
    writeOutput: (value) => output.push(value),
  });
  const permit = (JSON.parse(output[0]!) as { permit: string }).permit;
  const runtimeState: {
    current?: Awaited<ReturnType<typeof startSimulatorHostRuntime>>;
  } = {};
  const callSid = `CA_PHASE4_${suffix}`;
  const postCallback = async (path: string, form: Readonly<Record<string, string>>) => {
    const activeRuntime = runtimeState.current;
    if (activeRuntime === undefined) throw new Error("Simulator host is unavailable");
    const requestUrl = `${publicBaseUrl}${path}`;
    return await fetch(`${activeRuntime.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilioSignature(requestUrl, form),
        traceparent,
      },
      body: new URLSearchParams(form),
    });
  };
  const providerDispatch = vi.fn(
    async (
      request: { readonly operationId: string },
      custody: Parameters<
        NonNullable<Parameters<typeof startSimulatorHostRuntime>[0]["createProvider"]>
      >[0]["custody"],
    ) => {
      const callbackForm = { CallSid: callSid, From: syntheticCaller, To: syntheticTarget };
      expect((await postCallback("/twilio/voice", callbackForm)).status).toBe(200);
      if (input.callbackMode === "duplicate") {
        expect((await postCallback("/twilio/voice", callbackForm)).status).toBe(200);
      }
      const statusForm = { ...callbackForm, CallStatus: "completed", CallDuration: "7" };
      if (input.callbackMode === "status_before_canary") {
        expect((await postCallback("/twilio/status", statusForm)).status).toBe(204);
      }
      expect((await postCallback(`/twilio/canary/${operationId}`, callbackForm)).status).toBe(200);
      if (input.callbackMode === "duplicate") {
        expect((await postCallback(`/twilio/canary/${operationId}`, callbackForm)).status).toBe(
          200,
        );
      }
      if (input.callbackMode === "mismatched_status") {
        const mismatchedStatus = {
          ...callbackForm,
          CallSid: `${callSid}_MISMATCH`,
          CallStatus: "completed",
          CallDuration: "7",
        };
        const response = await postCallback("/twilio/status", mismatchedStatus);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("<Reject");
      } else if (input.callbackMode !== "status_before_canary") {
        expect((await postCallback("/twilio/status", statusForm)).status).toBe(204);
        if (input.callbackMode === "duplicate") {
          expect((await postCallback("/twilio/status", statusForm)).status).toBe(204);
        }
      }
      const transcript = [
        "zone-01 reports 71.5 degrees Fahrenheit.",
        "zone-02 reports 68.0 degrees Fahrenheit.",
        "zone-03 reports 68 percent.",
        `${input.invalidZone === true ? "zone-05" : "zone-04"} reports 82 percent.`,
      ].join("\n");
      const custodyMetadata = await custody.write({ operationId, transcript });
      return providerOutput({
        operationId: request.operationId,
        opaqueCustodyRef: custodyMetadata.opaqueReference,
        ...(input.invalidZone === true ? { invalidZone: true } : {}),
        ...(input.omitTranscript === true ? { omitTranscript: true } : {}),
      });
    },
  );
  const runtime = await startSimulatorHostRuntime({
    configuration: {
      runtimeProfile: "test",
      enabled: true,
      publicBaseUrl,
      demoOrigin: "http://127.0.0.1:4173",
      endpointAlias,
      authorizationAudience,
      callBudget: 1,
      concurrency: 1,
      timeoutMs: input.timeoutMs ?? 250,
      providerTerminalTimeoutMs: input.timeoutMs === undefined ? 1_000 : input.timeoutMs * 2,
      custodyRoot,
      custodyMaxTranscriptBytes: 16_384,
      custodyMaxEntries: 8,
      connectionString,
      jobsSchema: `phase4_${suffix.slice(0, 24)}`,
      organizationId: organizationId.value,
      listenHost: "127.0.0.1",
      listenPort: 0,
      apiToken: "test-only-provider-token-never-sent",
      targetAddress: "test-only-target-never-called",
      authorizedTargetDigest: identityDigest(syntheticTarget),
      callbackIdentityHmacKey,
      authorizationSigningKey: signingKey,
      twilioAuthToken,
      killSwitch: { assertDispatchAllowed: () => undefined },
    },
    runGate: createLiveSmokeRunGate("OPEN"),
    reconcileLiveSmoke: async ({ providerCallDigest }) => {
      expect(providerCallDigest).toBe(identityDigest(callSid));
      return Object.freeze({ outcome: "one_matching_call" as const, inboundCallCount: 1 });
    },
    createProvider: ({ custody }) => ({
      dispatch: async (request) => await providerDispatch(request, custody),
    }),
  });
  runtimeState.current = runtime;
  closers.push(async () => await runtime!.close());
  return {
    operationId,
    organizationId,
    pool,
    persistence,
    custodyRoot,
    providerDispatch,
    runtime,
    permit,
  };
}

async function activate(harness: Harness): Promise<void> {
  const response = await fetch(`${harness.runtime.baseUrl}/api/v1/live-simulator/operations`, {
    method: "POST",
    headers: { "content-type": "application/json", traceparent },
    body: JSON.stringify({
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      permit: harness.permit,
    }),
  });
  expect(response.status).toBe(202);
}

describe.sequential("CALL-E/Twilio greenhouse qualification durable composition", () => {
  it("AC-INTEGRATION-1 atomically commits one evidence, one observation, and four grounded readings at the observed 141 ms lead", async () => {
    const localNow = "2026-08-26T20:00:02.000Z";
    const capturedAt = "2026-08-26T20:00:02.141Z";
    const harness = await createAtomicResultHarness({ capturedAt, localNow });

    await expect(
      harness.resultPersistence.commitAtomically(
        { operationId: harness.operationId, result: harness.mapped.result },
        () => true,
      ),
    ).resolves.toEqual({
      disposition: "committed",
      winner: "observation_recorded",
    });
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 1,
      observation_count: 1,
      reading_count: 4,
    });
    const evidence = await harness.pool.query<{ captured_at: Date; retained_at: Date }>(
      `SELECT captured_at, retained_at
       FROM evidence_records
       WHERE organization_id = $1 AND call_attempt_id = $2`,
      [harness.organizationId.value, harness.operationId],
    );
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]!.captured_at.toISOString()).toBe(capturedAt);
    expect(evidence.rows[0]!.retained_at.toISOString()).toBe(capturedAt);
    const readings = await harness.pool.query<{ disposition: string }>(
      `SELECT disposition
       FROM readings
       WHERE organization_id = $1 AND operation_id = $2
       ORDER BY ordinal`,
      [harness.organizationId.value, harness.operationId],
    );
    expect(readings.rows.map(({ disposition }) => disposition)).toEqual([
      "grounded",
      "grounded",
      "grounded",
      "grounded",
    ]);
  }, 30_000);

  it("AC-INTEGRATION-2 rolls back every result row and preserves a typed safe failure at a 5,001 ms lead", async () => {
    const harness = await createAtomicResultHarness({
      localNow: "2026-08-26T20:00:02.000Z",
      capturedAt: "2026-08-26T20:00:07.001Z",
    });

    await expect(
      harness.resultPersistence.commitAtomically(
        { operationId: harness.operationId, result: harness.mapped.result },
        () => true,
      ),
    ).rejects.toMatchObject({
      name: "LiveSmokeResultPersistenceError",
      reason: "evidence_timestamp_invalid",
    });
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
    await expect(
      harness.persistence.callAttempts.findById(harness.organizationId, harness.operationId),
    ).resolves.toMatchObject({
      stage: "calling",
      latestEvidenceId: null,
      latestObservationId: null,
    });
  }, 30_000);

  it("returns the durable failure winner without retaining staged evidence when failure wins first", async () => {
    const harness = await createAtomicResultHarness({
      localNow: "2026-08-26T20:00:02.000Z",
      capturedAt: "2026-08-26T20:00:02.141Z",
    });
    const boundaries = createSimulatorHostCallAttemptBoundaries({
      organizationId: harness.organizationId,
      callAttempts: harness.persistence.callAttempts,
      now: () => "2026-08-26T20:00:03.000Z",
    });
    await expect(
      boundaries.terminalAttempts.recordFailure({
        operationId: harness.operationId,
        outcome: "provider_failed",
        retryable: false,
      }),
    ).resolves.toEqual({ terminalOutcome: "provider_failed" });

    await expect(
      harness.resultPersistence.commitAtomically(
        { operationId: harness.operationId, result: harness.mapped.result },
        () => true,
      ),
    ).resolves.toEqual({
      disposition: "committed",
      winner: "terminal_failure",
      terminalOutcome: "provider_failed",
    });
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
  }, 30_000);

  it("does not report a terminal winner created only inside a rolled-back result transaction", async () => {
    const harness = await createAtomicResultHarness({
      localNow: "2026-08-26T20:00:02.000Z",
      capturedAt: "2026-08-26T20:00:02.141Z",
    });
    const rollbackOnlyFailure = createAtomicLiveResultPersistence({
      organizationId: harness.organizationId,
      callAttempts: harness.persistence.callAttempts,
      runObservationResultTransaction: harness.persistence.runObservationResultTransaction,
      createRecordResult: (repositories) => ({
        execute: async (input) => {
          const attempt = await repositories.attempts.recordTerminalFailure({
            organizationId: input.organizationId,
            operationId: input.operationId,
            outcome: "evidence_unavailable",
            retryable: false,
            transitionedAt: "2026-08-26T20:00:03.000Z",
          });
          return Object.freeze({ kind: "terminal_failure" as const, attempt });
        },
      }),
    });

    await expect(
      rollbackOnlyFailure.commitAtomically(
        { operationId: harness.operationId, result: harness.mapped.result },
        () => true,
      ),
    ).resolves.toEqual({ disposition: "blocked" });
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
    await expect(
      harness.persistence.callAttempts.findById(harness.organizationId, harness.operationId),
    ).resolves.toMatchObject({
      stage: "calling",
      terminalOutcome: null,
      latestEvidenceId: null,
      latestObservationId: null,
    });
  }, 30_000);

  it("waits for the real PostgreSQL commit before allowing a later terminal signal to settle", async () => {
    const capturedAt = "2026-08-26T20:00:02.141Z";
    const harness = await createAtomicResultHarness({
      localNow: "2026-08-26T20:00:02.000Z",
      capturedAt,
    });
    const attempt = await harness.persistence.callAttempts.findById(
      harness.organizationId,
      harness.operationId,
    );
    expect(attempt).toBeDefined();
    let reportCommitted: (() => void) | undefined;
    const committed = new Promise<void>((resolve) => {
      reportCommitted = resolve;
    });
    let releaseAdapter: (() => void) | undefined;
    const adapterRelease = new Promise<void>((resolve) => {
      releaseAdapter = resolve;
    });
    const resultPersistence = {
      commitAtomically: vi.fn(
        async (...args: Parameters<typeof harness.resultPersistence.commitAtomically>) => {
          const disposition = await harness.resultPersistence.commitAtomically(...args);
          reportCommitted?.();
          await adapterRelease;
          return disposition;
        },
      ),
    };
    let terminalListener:
      ((reason: "provider_failed" | "persistence_unavailable") => void) | undefined;
    const durableBoundaries = createSimulatorHostCallAttemptBoundaries({
      organizationId: harness.organizationId,
      callAttempts: harness.persistence.callAttempts,
      now: () => "2026-08-26T20:00:03.000Z",
    });
    const terminalWrite = vi.fn(durableBoundaries.terminalAttempts.recordFailure);
    const runner = createLiveSmokeRunner({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        killSwitchAllows: true,
        syntheticTargetAuthorized: true,
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 10_000,
        endpointAlias,
        authorizationAudience,
        requireCallbackEvidence: true,
      },
      resolvedSecrets: {
        calleApiToken: "test-only-token",
        targetAddress: "test-only-synthetic-target",
      },
      authorizationBoundary: { reserve: async () => "reserved" as const },
      evidencePersistence: { persistAdmission: async () => undefined },
      reviewedConfidenceTokens: ["provider-observed"],
      observability: {
        establishTraceContext: (value) => value!,
        record: vi.fn(),
      },
      terminalAttempts: { recordFailure: terminalWrite },
      dispatchAttempts: {
        claim: async () => ({
          providerDispatchIdentity: attempt!.providerDispatchIdentity,
          adapterVersionId: attempt!.adapterVersionId,
        }),
      },
      dtmfSafetyStop: createDtmfSafetyStop(),
      runGate: createLiveSmokeRunGate("OPEN"),
      evidenceCoordinator: {
        claimTerminalPersistence: () => "runner",
        onTerminal: (_input, listener) => {
          terminalListener = listener;
          return () => undefined;
        },
        settle: () => "runner",
        completeTerminalPersistence: async () => undefined,
        begin: () => undefined,
        recordCalleTerminal: async () => undefined,
        assertReady: async () => ({
          outcome: "ready",
          dtmfActions: 0,
          twilioReconciliation: "1 matching call",
        }),
      },
      resultPersistence,
      dispatch: async () =>
        providerOutput({
          operationId: harness.operationId,
          opaqueCustodyRef: "local-transcript://opaque-result-first",
          observedAt: capturedAt,
        }),
    });
    let settled = false;
    const pending = runner
      .execute({
        operationId: harness.operationId,
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        runAuthorization: "test-only-signed-authorization",
        traceContext: { traceparent },
      })
      .finally(() => {
        settled = true;
      });

    await committed;
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 1,
      observation_count: 1,
      reading_count: 4,
    });
    terminalListener?.("provider_failed");
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseAdapter?.();

    await expect(pending).resolves.toMatchObject({ status: "completed" });
    expect(terminalWrite).not.toHaveBeenCalled();
  }, 30_000);

  it("bounds a row-lock-stalled result transaction and rolls back without partial rows", async () => {
    const harness = await createAtomicResultHarness({
      localNow: "2026-08-26T20:00:02.000Z",
      capturedAt: "2026-08-26T20:00:02.141Z",
      transactionMaxWaitMs: 50,
      transactionTimeoutMs: 100,
    });
    const locker = await harness.pool.connect();
    await locker.query("BEGIN");
    await locker.query(
      `SELECT id FROM call_attempts
       WHERE organization_id = $1 AND id = $2
       FOR UPDATE`,
      [harness.organizationId.value, harness.operationId],
    );

    try {
      await expect(
        harness.resultPersistence.commitAtomically(
          { operationId: harness.operationId, result: harness.mapped.result },
          () => true,
        ),
      ).rejects.toMatchObject({
        name: "LiveSmokeResultPersistenceError",
        reason: "application_persistence_failed",
      });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
  }, 30_000);

  it("AC-HAPPY-1/2 and AC-ASYNC-1 orders signed callback facts, custody, and one exact four-reading transaction under duplicate delivery", async () => {
    const harness = await createHarness({ callbackMode: "duplicate" });
    await activate(harness);

    const projection = await waitForTerminal(harness.runtime.baseUrl, harness.operationId);
    expect(projection).toMatchObject({
      terminalOutcome: "observation_recorded",
      provenance: "SIMULATED",
      evidence: { quality: "complete" },
      readings: [
        { zoneId: "zone-01", value: "71.5", disposition: "grounded" },
        { zoneId: "zone-02", value: "68.0", disposition: "grounded" },
        { zoneId: "zone-03", value: "68", disposition: "grounded" },
        { zoneId: "zone-04", value: "82", disposition: "grounded" },
      ],
    });
    expect(harness.providerDispatch).toHaveBeenCalledOnce();
    const facts = await harness.persistence.liveSimulatorProviderFacts.listForOperation(
      harness.organizationId,
      harness.operationId,
    );
    expect(facts.map(({ phase }) => phase)).toEqual([
      "voice",
      "canary",
      "status",
      "calle_terminal",
      "reconciliation",
    ]);
    expect(facts).toHaveLength(5);
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 1,
      observation_count: 1,
      reading_count: 4,
    });
    const custodyEntries = await readdir(harness.custodyRoot);
    expect(custodyEntries.filter((name) => name.endsWith(".transcript"))).toHaveLength(1);
  }, 30_000);

  it("AC-ERROR-4 rejects a signed but identity-conflicting status callback and terminalizes result-free after the bounded lifecycle deadline", async () => {
    const harness = await createHarness({ callbackMode: "mismatched_status", timeoutMs: 150 });
    await activate(harness);

    await expect(
      waitForTerminal(harness.runtime.baseUrl, harness.operationId),
    ).resolves.toMatchObject({
      terminalOutcome: "provider_failed",
      readings: [],
      evidence: null,
    });
    expect(harness.providerDispatch).toHaveBeenCalledOnce();
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
  }, 30_000);

  it("AC-ERROR-4 rejects individually signed status-before-canary callback order and terminalizes result-free", async () => {
    const harness = await createHarness({ callbackMode: "status_before_canary" });
    await activate(harness);

    await expect(
      waitForTerminal(harness.runtime.baseUrl, harness.operationId),
    ).resolves.toMatchObject({
      terminalOutcome: "provider_failed",
      readings: [],
      evidence: null,
    });
    expect(harness.providerDispatch).toHaveBeenCalledOnce();
    const facts = await harness.persistence.liveSimulatorProviderFacts.listForOperation(
      harness.organizationId,
      harness.operationId,
    );
    expect(facts.map(({ phase }) => phase)).toEqual([
      "voice",
      "status",
      "canary",
      "calle_terminal",
      "reconciliation",
    ]);
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
  }, 30_000);

  it("AC-ERROR-2 rejects terminal CALL-E evidence without its bounded transcript before derivation and remains result-free", async () => {
    const harness = await createHarness({ callbackMode: "complete", omitTranscript: true });
    await activate(harness);

    await expect(
      waitForTerminal(harness.runtime.baseUrl, harness.operationId),
    ).resolves.toMatchObject({
      terminalOutcome: "provider_failed",
      readings: [],
      evidence: null,
    });
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
  }, 30_000);

  it("AC-ERROR-5 rolls back the EvidenceRecord with Observation and Reading writes when revision-2 zone reconciliation rejects provider evidence", async () => {
    const harness = await createHarness({ callbackMode: "complete", invalidZone: true });
    await activate(harness);

    await expect(
      waitForTerminal(harness.runtime.baseUrl, harness.operationId),
    ).resolves.toMatchObject({
      terminalOutcome: "evidence_unavailable",
      readings: [],
      evidence: null,
    });
    await expect(
      rowCounts(harness.pool, harness.organizationId, harness.operationId),
    ).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
  }, 30_000);

  it("AC-ASYNC-1 rechecks the process-lifetime DTMF stop after staged real PostgreSQL writes and rolls the transaction back", async () => {
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = OrganizationId.create(`org-phase4-barrier-${suffix}`);
    const operationId = `operation-phase4-barrier-${suffix}`;
    const pool = new Pool({
      connectionString,
      max: 2,
      statement_timeout: 4_000,
      lock_timeout: 4_000,
    });
    const persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });
    closers.push(
      async () =>
        await Promise.allSettled([persistence.disconnect(), pool.end()]).then(() => undefined),
    );
    const profile = EndpointObservationProfile.create({
      endpointId: endpointAlias,
      organizationId,
      adapterVersionId: `adapter-phase4-${suffix}`,
      expectedZones: [
        ["zone-01", "degrees Fahrenheit", "degF"],
        ["zone-02", "degrees Fahrenheit", "degF"],
        ["zone-03", "percent", "percent"],
        ["zone-04", "percent", "percent"],
      ].map(([zoneId, spokenUnit, normalizedUnit], ordinal) => ({
        zoneId: zoneId!,
        ordinal,
        applicability: "required" as const,
        requiredFacet: "measurement" as const,
        allowedUnitMappings: [
          {
            ruleId: "calle-provider-observed.v1",
            spokenUnit: spokenUnit!,
            normalizedUnit: normalizedUnit!,
          },
        ],
      })),
      dtmfPolicy: { kind: "forbidden" },
      compatibility: "simulator-tested",
      provenance: "SIMULATED",
      authorizationReferenceId: "phase4-local-only",
    });
    await persistence.observationProfiles.establish(profile);
    const request = new RequestObservation({
      profiles: persistence.observationProfiles,
      attempts: persistence.callAttempts,
      scheduler: {
        scheduleObservation: async () => ({ outcome: "scheduled", jobId: "job-phase4" }),
      },
      clock: { now: () => "2026-08-26T20:00:00.000Z" },
      identifiers: { generate: () => operationId },
    });
    await request.execute({
      organizationId,
      endpointId: endpointAlias,
      pollWindowId: "synthetic-normal@2",
      idempotencyKey: `phase4:${operationId}`,
      correlationId: operationId,
      trigger: "manual",
    });
    await persistence.callAttempts.recordCalling({
      organizationId,
      operationId,
      transitionedAt: "2026-08-26T20:00:01.000Z",
    });
    const mapped = await mapCalleTerminalOutput(
      providerOutput({ operationId, opaqueCustodyRef: "local-transcript://opaque-phase4-barrier" }),
      { operationId, adapterVersionId: profile.adapterVersionId, simulationRunId: operationId },
      { reviewedConfidenceTokens: ["provider-observed"], persistAdmission: async () => undefined },
    );
    const safetyStop = createDtmfSafetyStop();
    const retainedAt = new Date(Date.now() + 60_000).toISOString();
    const resultPersistence = createAtomicLiveResultPersistence({
      organizationId,
      callAttempts: persistence.callAttempts,
      runObservationResultTransaction: persistence.runObservationResultTransaction,
      createRecordResult: (repositories) => {
        const delegate = new RecordObservationResult({
          ...repositories,
          clock: { now: () => retainedAt },
          identifiers: { generate: randomUUID },
        });
        return {
          execute: async (executeInput) => {
            const output = await delegate.execute(executeInput);
            safetyStop.observe({ Digits: "test-only-redacted-dtmf" });
            return output;
          },
        };
      },
    });

    await expect(
      resultPersistence.commitAtomically(
        { operationId, result: mapped.result },
        () => !safetyStop.isBlocked(),
      ),
    ).resolves.toEqual({ disposition: "blocked" });
    await expect(rowCounts(pool, organizationId, operationId)).resolves.toEqual({
      evidence_count: 0,
      observation_count: 0,
      reading_count: 0,
    });
    await expect(
      persistence.callAttempts.findById(organizationId, operationId),
    ).resolves.toMatchObject({
      stage: "calling",
      latestEvidenceId: null,
      latestObservationId: null,
    });
  }, 30_000);
});

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSimulatorLiveClient } from "../../packages/api-client/src/simulator-live-client.js";
import { OrganizationId } from "@muster/domain";
import { createPostgresPersistence } from "@muster/infrastructure-postgres";
import {
  deployMigrations,
  getPostgresTestConnectionUrls,
  SIMULATOR_SCENARIO_CATALOG,
} from "@muster/testing";

import { authorizeLiveSimulatorRun } from "../../apps/simulator-host/src/composition/authorize-live-simulator-run.js";
import { startSimulatorHostRuntime } from "../../apps/simulator-host/src/composition/start-simulator-host-runtime.js";

const signingKey = "phase-five-test-signing-key-with-at-least-32-bytes";
const endpointAlias = "greenhouse-synthetic";
const publicBaseUrl = "https://simulator.invalid";
const learnedCallerDigest = "a".repeat(64);
const authorizedTargetDigest = "b".repeat(64);
const callbackIdentityHmacKey = "local-callback-hmac-key-with-at-least-32-bytes";

type ScenarioId = "synthetic-normal" | "synthetic-abnormal" | "synthetic-recovery";

const independentOracle = Object.freeze({
  "synthetic-normal": Object.freeze({
    transcriptToken: "68.0 degrees Fahrenheit and OK",
    zone2: Object.freeze({ value: "68.0", status: "OK" as const }),
  }),
  "synthetic-abnormal": Object.freeze({
    transcriptToken: "82.5 degrees Fahrenheit and ALARM",
    zone2: Object.freeze({ value: "82.5", status: "ALARM" as const }),
  }),
  "synthetic-recovery": Object.freeze({
    transcriptToken: "69.0 degrees Fahrenheit and OK",
    zone2: Object.freeze({ value: "69.0", status: "OK" as const }),
  }),
});

// This injected local provider behavior is deliberately separate from the reviewed
// oracle below. Production derivation receives only its returned provider facts.
const localProviderReports = Object.freeze({
  "synthetic-normal": Object.freeze({
    transcript: "SIMULATED report: Zone 2 is 68.0 degrees Fahrenheit and OK.",
    zone2Value: "68.0",
    zone2Status: "OK" as const,
  }),
  "synthetic-abnormal": Object.freeze({
    transcript: "SIMULATED report: Zone 2 is 82.5 degrees Fahrenheit and ALARM.",
    zone2Value: "82.5",
    zone2Status: "ALARM" as const,
  }),
  "synthetic-recovery": Object.freeze({
    transcript: "SIMULATED report: Zone 2 is 69.0 degrees Fahrenheit and OK.",
    zone2Value: "69.0",
    zone2Status: "OK" as const,
  }),
});

function providerResult(scenarioId: ScenarioId, operationId: string) {
  const report = localProviderReports[scenarioId];
  const values = ["71.5", report.zone2Value, "68", "82"] as const;
  const statuses = ["OK", report.zone2Status, "OK", "OK"] as const;
  return Object.freeze({
    providerCallId: `local-provider-${operationId}`,
    terminalStatus: "completed",
    observedAt: new Date().toISOString(),
    evidence: Object.freeze({
      providerRevisionId: `local-${scenarioId}-1`,
      opaqueCustodyRef: `opaque-${operationId}`,
      sourceCompleteness: "complete",
      transcript: Object.freeze([
        Object.freeze({
          speaker: "device",
          text: report.transcript,
        }),
      ]),
      readings: Object.freeze(
        values.map((value, index) =>
          Object.freeze({
            zoneId: `zone-0${String(index + 1)}`,
            value,
            spokenUnit: index < 2 ? "degrees Fahrenheit" : "percent",
            normalizedUnit: index < 2 ? "degF" : "percent",
            status: statuses[index],
            confidenceToken: "provider-observed",
            sourceAnchor: Object.freeze({
              anchorId: `anchor-${String(index)}`,
              valueToken: value,
              spokenUnitToken: index < 2 ? "degrees Fahrenheit" : "percent",
              opaqueSourceRef: `source-${operationId}-${String(index)}`,
            }),
          }),
        ),
      ),
      auxiliaryStatus: Object.freeze({
        sound: "normal",
        power: "mains_available",
        battery: "normal",
        output: "off",
      }),
    }),
  });
}

describe.sequential("hackathon live CALL-E observation local composition", () => {
  const closers: (() => Promise<void>)[] = [];
  let connectionString = "";
  let organizationId: OrganizationId;
  let persistence: ReturnType<typeof createPostgresPersistence>;

  beforeEach(async () => {
    connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    organizationId = OrganizationId.create(`org-phase-five-${randomUUID()}`);
    const pool = new Pool({ connectionString, max: 2 });
    persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });
    const testPersistence = persistence;
    closers.push(
      async () =>
        await Promise.all([testPersistence.disconnect(), pool.end()]).then(() => undefined),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const close of closers.splice(0).reverse()) await close();
  });

  async function mint(
    operationId: string,
    scenarioId: ScenarioId,
    predecessorOperationId?: string,
  ) {
    const pool = new Pool({ connectionString, max: 1 });
    const persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });
    const output: string[] = [];
    try {
      await authorizeLiveSimulatorRun({
        argv: [
          "--scenario",
          scenarioId,
          ...(predecessorOperationId === undefined
            ? []
            : ["--predecessor", predecessorOperationId]),
        ],
        configuration: {
          organizationId: organizationId.value,
          endpointAlias,
          authorizationAudience: "muster-live-simulator",
          authorizationSigningKey: signingKey,
          authorizedTargetDigest,
          publicBaseUrl,
        },
        authorizationIssuer: persistence.liveSimulatorAuthorizations,
        predecessorLookup: {
          find: async () => ({
            scenarioId: "synthetic-abnormal",
            scenarioRevision: 2,
            terminal: true,
            hasEvidence: true,
            provenance: "SIMULATED",
          }),
        },
        scenarios: SIMULATOR_SCENARIO_CATALOG,
        generateOperationId: () => operationId,
        generateNonce: () => `nonce-${operationId}`,
        writeOutput: (value) => output.push(value),
      });
      await expect(
        persistence.liveSimulatorAuthorizations.findByOperationId(organizationId, operationId),
      ).resolves.toMatchObject({
        callerDigest: null,
        authorizedTargetDigest,
        publicOrigin: publicBaseUrl,
        purpose: "non-production-synthetic-live-smoke",
        callBudget: 1,
        concurrency: 1,
        retryBudget: 0,
        dtmfPolicy: "forbidden",
        terminalDeadlineSeconds: 120,
      });
      return (JSON.parse(output[0]!) as { permit: string }).permit;
    } finally {
      await Promise.allSettled([persistence.disconnect(), pool.end()]);
    }
  }

  async function run(scenarioId: ScenarioId, operationId: string, predecessorOperationId?: string) {
    const permit = await mint(operationId, scenarioId, predecessorOperationId);
    const directory = await mkdtemp(path.join(tmpdir(), "muster-phase-five-"));
    const dispatch = vi.fn(async () => providerResult(scenarioId, operationId));
    let runtime: Awaited<ReturnType<typeof startSimulatorHostRuntime>> | undefined;
    try {
      runtime = await startSimulatorHostRuntime({
        configuration: {
          runtimeProfile: "test",
          enabled: true,
          publicBaseUrl,
          demoOrigin: "http://127.0.0.1:4173",
          endpointAlias,
          authorizationAudience: "muster-live-simulator",
          callBudget: 1,
          concurrency: 1,
          timeoutMs: 2_000,
          providerTerminalTimeoutMs: 5_000,
          custodyRoot: path.join(directory, "custody"),
          custodyMaxTranscriptBytes: 16_384,
          custodyMaxEntries: 8,
          connectionString,
          jobsSchema: `phase_five_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          organizationId: organizationId.value,
          listenHost: "127.0.0.1",
          listenPort: 0,
          apiToken: "local-test-token-never-sent",
          targetAddress: "local-test-target-never-called",
          authorizedTargetDigest,
          callbackIdentityHmacKey,
          authorizationSigningKey: signingKey,
          twilioAuthToken: "local-test-twilio-token",
          killSwitch: { assertDispatchAllowed: () => undefined },
        },
        createProvider: () => ({ dispatch }),
      });
      const nativeFetch = globalThis.fetch;
      const loopbackFetch: typeof fetch = async (request, init) => {
        const url = new URL(
          typeof request === "string" || request instanceof URL ? request : request.url,
        );
        if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
          throw new Error("External network is forbidden in Phase 5 composition tests");
        }
        return await nativeFetch(request, init);
      };
      const client = createSimulatorLiveClient({ baseUrl: runtime.baseUrl, fetch: loopbackFetch });
      const accepted = await client.requestLiveObservation({
        scenarioId,
        scenarioRevision: 2,
        permit,
      });
      expect(accepted.ok).toBe(true);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const result = await client.getLiveObservation(operationId, {
          scenarioId,
          scenarioRevision: 2,
        });
        if (result.ok && result.data.terminal) {
          // The injected provider has no Twilio transport. Model the one exact signed-callback
          // binding locally so a later recovery run sees the same durable predecessor state.
          const providerCallDigest = createHash("sha256")
            .update(`local-callback:${operationId}`, "utf8")
            .digest("hex");
          const binding = await persistence.liveSimulatorAuthorizations.claimInitialCallback({
            organizationId,
            endpointAlias,
            audience: "muster-live-simulator",
            providerCallDigest,
            callerDigest: learnedCallerDigest,
            authorizedTargetDigest,
            boundAt: new Date().toISOString(),
          });
          expect(binding.outcome).toBe("bound");
          await expect(
            persistence.liveSimulatorAuthorizations.findByOperationId(organizationId, operationId),
          ).resolves.toMatchObject({
            state: "bound",
            callerDigest: learnedCallerDigest,
            providerDispatchIdentity: providerCallDigest,
          });
          await expect(
            persistence.liveSimulatorAuthorizations.authenticateBoundCallback({
              organizationId,
              operationId,
              endpointAlias,
              audience: "muster-live-simulator",
              providerCallDigest,
              callerDigest: "c".repeat(64),
              authorizedTargetDigest,
            }),
          ).resolves.toEqual({ outcome: "unmatched" });
          return { projection: result.data, dispatch };
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`Timed out waiting for ${operationId}`);
    } finally {
      await runtime?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("composes disposable PostgreSQL, pg-boss, host, and bounded client through loopback only", async () => {
    const result = await run("synthetic-normal", `operation-normal-${randomUUID()}`);
    expect(result.projection).toMatchObject({
      terminalOutcome: "observation_recorded",
      provenance: "SIMULATED",
      evidence: { quality: "complete" },
    });
    expect(result.dispatch).toHaveBeenCalledOnce();
    expect(result.dispatch).toHaveBeenCalledWith(expect.objectContaining({ retryLimit: 0 }));
    await expect(
      import("node:fs/promises").then(({ readFile }) =>
        readFile(path.resolve("docs/demo/hackathon-live-calle-observation.md"), "utf8"),
      ),
    ).resolves.toContain("Disposable local composition");
  }, 30_000);

  it("uses an independent oracle to prove input-distinct provider evidence is not a fixture stub", async () => {
    const normal = await run("synthetic-normal", `operation-normal-${randomUUID()}`);
    const abnormal = await run("synthetic-abnormal", `operation-abnormal-${randomUUID()}`);
    expect(normal.projection.transcript[0]?.text).toContain(
      independentOracle["synthetic-normal"].transcriptToken,
    );
    expect(abnormal.projection.transcript[0]?.text).toContain(
      independentOracle["synthetic-abnormal"].transcriptToken,
    );
    expect(normal.projection.readings[1]).toMatchObject(
      independentOracle["synthetic-normal"].zone2,
    );
    expect(abnormal.projection.readings[1]).toMatchObject(
      independentOracle["synthetic-abnormal"].zone2,
    );
    expect(normal.projection.transcript).not.toEqual(abnormal.projection.transcript);
    expect(normal.projection.readings).not.toEqual(abnormal.projection.readings);
    await expect(
      import("node:fs/promises").then(({ readFile }) =>
        readFile(path.resolve("docs/demo/awesome-phone-call-agents-submission.md"), "utf8"),
      ),
    ).resolves.toContain("Independent anti-stub proof");
  }, 45_000);

  it("persists exact abnormal-to-recovery lineage across separate one-use runtimes", async () => {
    const abnormalOperationId = `operation-abnormal-${randomUUID()}`;
    const recoveryOperationId = `operation-recovery-${randomUUID()}`;
    const abnormal = await run("synthetic-abnormal", abnormalOperationId);
    const recovery = await run("synthetic-recovery", recoveryOperationId, abnormalOperationId);
    expect(abnormal.projection).toMatchObject({
      operationId: abnormalOperationId,
      terminalOutcome: "observation_recorded",
    });
    expect(recovery.projection).toMatchObject({
      operationId: recoveryOperationId,
      terminalOutcome: "recovery_candidate",
      predecessorOperationId: abnormalOperationId,
      provenance: "SIMULATED",
    });
    expect(recovery.projection.transcript[0]?.text).toContain(
      independentOracle["synthetic-recovery"].transcriptToken,
    );
    await expect(
      import("node:fs/promises").then(({ readFile }) =>
        readFile(path.resolve("docs/demo/hackathon-live-calle-observation.md"), "utf8"),
      ),
    ).resolves.toContain("exact predecessor operation ID");
  }, 45_000);
});

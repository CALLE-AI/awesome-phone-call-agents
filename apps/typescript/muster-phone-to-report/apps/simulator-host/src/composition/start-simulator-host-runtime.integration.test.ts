import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";
import { createPostgresPersistence } from "@muster/infrastructure-postgres";
import {
  deployMigrations,
  getPostgresTestConnectionUrls,
  SIMULATOR_SCENARIO_CATALOG,
} from "@muster/testing";

import { authorizeLiveSimulatorRun } from "./authorize-live-simulator-run.js";
import { startSimulatorHostRuntime } from "./start-simulator-host-runtime.js";

const signingKey = "test-only-signing-key-with-at-least-32-bytes";
const authorizedTargetDigest = "b".repeat(64);
const callbackIdentityHmacKey = "test-only-callback-key-with-at-least-32-bytes";

async function waitForTerminal(baseUrl: string, operationId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/live-simulator/operations/${operationId}`);
    if (response.ok) {
      const body = (await response.json()) as { terminal?: boolean };
      if (body.terminal === true) return body as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for terminal live operation ${operationId}`);
}

describe("real disposable simulator-host composition", () => {
  it("starts PostgreSQL, pg-boss, custody, Twilio HTTP, and observability without constructing or calling a provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "muster-real-simulator-host-"));
    const killSwitchFile = join(directory, "kill-switch");
    await writeFile(killSwitchFile, "ALLOW\n", { encoding: "utf8", mode: 0o600 });
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const runtime = await startSimulatorHostRuntime({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        publicBaseUrl: "https://simulator.invalid",
        demoOrigin: "http://127.0.0.1:4173",
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 1_000,
        providerTerminalTimeoutMs: 180_000,
        custodyRoot: join(directory, "custody"),
        custodyMaxTranscriptBytes: 16_384,
        custodyMaxEntries: 8,
        connectionString,
        jobsSchema: `simulator_${process.env["MUSTER_TEST_RUN_NONCE"] ?? "invalid"}`,
        organizationId: "org-real-simulator-host",
        listenHost: "127.0.0.1",
        listenPort: 0,
        apiToken: "test-only-provider-token-never-used",
        targetAddress: "test-only-target-never-called",
        authorizedTargetDigest,
        callbackIdentityHmacKey,
        authorizationSigningKey: "test-only-signing-key-with-at-least-32-bytes",
        twilioAuthToken: "test-only-twilio-token",
        killSwitch: {
          assertDispatchAllowed: () => undefined,
        },
      },
    });

    try {
      expect(runtime.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      const response = await fetch(`${runtime.baseUrl}/twilio/voice`, { method: "GET" });
      expect(response.status).toBe(405);
      expect(await response.text()).toBe("");
    } finally {
      await runtime.close();
    }
  });

  it("runs real HTTP, PostgreSQL, and pg-boss with a non-network provider while reservation failures stay pre-dispatch", async () => {
    const connectionString = getPostgresTestConnectionUrls().repository;
    await deployMigrations(connectionString);
    const suffix = `${process.env["MUSTER_TEST_RUN_NONCE"] ?? "missing"}review`;
    const organizationId = OrganizationId.create(`org-runtime-${suffix}`);
    const pool = new Pool({ connectionString, max: 2 });
    const persistence = createPostgresPersistence(pool, { probeTimeoutMs: 500 });

    const permits = new Map<string, string>();
    const mint = async (input: {
      operationId: string;
      scenarioId: "synthetic-normal" | "synthetic-recovery";
      predecessorOperationId?: string;
    }) => {
      const output: string[] = [];
      await authorizeLiveSimulatorRun({
        argv: [
          "--scenario",
          input.scenarioId,
          ...(input.predecessorOperationId === undefined
            ? []
            : ["--predecessor", input.predecessorOperationId]),
        ],
        configuration: {
          organizationId: organizationId.value,
          endpointAlias: "greenhouse-synthetic",
          authorizationAudience: "muster-live-simulator",
          authorizationSigningKey: signingKey,
          authorizedTargetDigest,
          publicBaseUrl: "https://simulator.invalid",
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
        generateOperationId: () => input.operationId,
        generateNonce: () => `nonce-${input.operationId}`,
        writeOutput: (value) => output.push(value),
      });
      permits.set(input.operationId, (JSON.parse(output[0]!) as { permit: string }).permit);
    };

    const invalidPredecessorId = `operation-invalid-predecessor-${suffix}`;
    const finalReservationFailureId = `operation-final-reservation-${suffix}`;
    const successfulId = `operation-success-${suffix}`;
    await mint({
      operationId: invalidPredecessorId,
      scenarioId: "synthetic-recovery",
      predecessorOperationId: `operation-absent-${suffix}`,
    });
    await mint({ operationId: finalReservationFailureId, scenarioId: "synthetic-normal" });
    await mint({ operationId: successfulId, scenarioId: "synthetic-normal" });

    const providerDispatch = vi.fn(async ({ operationId }: { operationId: string }) => ({
      providerCallId: `provider-${operationId}`,
      terminalStatus: "completed",
      observedAt: new Date().toISOString(),
      evidence: {
        providerRevisionId: "provider-revision-1",
        opaqueCustodyRef: "custody-opaque-1",
        sourceCompleteness: "complete",
        transcript: [{ speaker: "device", text: "Four-zone greenhouse report." }],
        readings: [
          ["zone-01", "71.5", "degrees Fahrenheit", "degF"],
          ["zone-02", "68.0", "degrees Fahrenheit", "degF"],
          ["zone-03", "68", "percent", "percent"],
          ["zone-04", "82", "percent", "percent"],
        ].map(([zoneId, value, spokenUnit, normalizedUnit], index) => ({
          zoneId,
          value,
          spokenUnit,
          normalizedUnit,
          status: "OK",
          confidenceToken: "provider-observed",
          sourceAnchor: {
            anchorId: `anchor-${String(index)}`,
            valueToken: value,
            spokenUnitToken: index < 2 ? spokenUnit : "%",
            opaqueSourceRef: `source-${String(index)}`,
          },
        })),
        auxiliaryStatus: {
          sound: "normal",
          power: "mains_available",
          battery: "normal",
          output: "off",
        },
      },
    }));
    const directory = await mkdtemp(join(tmpdir(), "muster-live-runtime-review-"));
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof request === "string" || request instanceof URL ? request : request.url,
      );
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        throw new Error("External network is forbidden in simulator-host composition tests");
      }
      return await nativeFetch(request, init);
    });
    const runtime = await startSimulatorHostRuntime({
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        publicBaseUrl: "https://simulator.invalid",
        demoOrigin: "http://127.0.0.1:4173",
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 2_000,
        providerTerminalTimeoutMs: 180_000,
        custodyRoot: join(directory, "custody"),
        custodyMaxTranscriptBytes: 16_384,
        custodyMaxEntries: 8,
        connectionString,
        jobsSchema: `simulator_${suffix}`,
        organizationId: organizationId.value,
        listenHost: "127.0.0.1",
        listenPort: 0,
        apiToken: "test-only-provider-token-never-sent",
        targetAddress: "test-only-target-never-called",
        authorizedTargetDigest,
        callbackIdentityHmacKey,
        authorizationSigningKey: signingKey,
        twilioAuthToken: "test-only-twilio-token",
        killSwitch: { assertDispatchAllowed: () => undefined },
      },
      createProvider: () => ({ dispatch: providerDispatch as never }),
      decorateAuthorizationBoundary: (boundary) => ({
        reserve: async (request) => {
          if (request.runId === finalReservationFailureId) {
            throw new Error("injected final reservation-store failure");
          }
          return await boundary.reserve(request);
        },
      }),
    });

    const post = async (operationId: string, scenarioId: string) => {
      const response = await fetch(`${runtime.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId,
          scenarioRevision: 2,
          permit: permits.get(operationId),
        }),
      });
      expect(response.status).toBe(202);
    };

    try {
      await post(invalidPredecessorId, "synthetic-recovery");
      await expect(waitForTerminal(runtime.baseUrl, invalidPredecessorId)).resolves.toMatchObject({
        terminalOutcome: "blocked",
      });
      expect(providerDispatch).not.toHaveBeenCalled();

      await post(finalReservationFailureId, "synthetic-normal");
      await expect(
        waitForTerminal(runtime.baseUrl, finalReservationFailureId),
      ).resolves.toMatchObject({ terminalOutcome: "blocked" });
      expect(providerDispatch).not.toHaveBeenCalled();

      await post(successfulId, "synthetic-normal");
      await expect(waitForTerminal(runtime.baseUrl, successfulId)).resolves.toMatchObject({
        terminalOutcome: "observation_recorded",
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        provenance: "SIMULATED",
      });
      await expect(
        persistence.observations.findOperation(organizationId, successfulId),
      ).resolves.toMatchObject({
        terminalOutcome: "observation_recorded",
        observation: {
          quality: "complete",
          readings: [
            { zoneId: "zone-01", disposition: "grounded" },
            { zoneId: "zone-02", disposition: "grounded" },
            {
              zoneId: "zone-03",
              disposition: "grounded",
              spokenUnit: "%",
              normalizedUnit: "percent",
            },
            {
              zoneId: "zone-04",
              disposition: "grounded",
              spokenUnit: "%",
              normalizedUnit: "percent",
            },
          ],
        },
      });
      expect(providerDispatch).toHaveBeenCalledOnce();
      expect(providerDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: successfulId, retryLimit: 0 }),
      );
    } finally {
      await runtime.close();
      await Promise.allSettled([persistence.disconnect(), pool.end()]);
      vi.unstubAllGlobals();
    }
  }, 30_000);
});

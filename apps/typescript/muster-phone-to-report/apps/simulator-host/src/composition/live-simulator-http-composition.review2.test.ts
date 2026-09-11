import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@muster/application";
import {
  createDtmfSafetyStop,
  createLiveSmokeRunner,
  verifyRunAuthorization,
} from "@muster/infrastructure-twilio-simulator";

import {
  createLiveSimulatorController,
  startSimulatorHostHttpRuntime,
} from "../live-runs/live-simulator-http-runtime.js";
import { authorizeLiveSimulatorRun } from "./authorize-live-simulator-run.js";

const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const signingKey = "test-only-signing-key-with-at-least-32-bytes";
const authorizedTargetDigest = "b".repeat(64);

describe("disposable live simulator HTTP composition", () => {
  it("flows a CLI permit through POST, durable queue, reservation, local provider evidence, and GET while blocking invalid predecessors and reservations before provider dispatch", async () => {
    const issued: unknown[] = [];
    const output: string[] = [];
    let operationSequence = 0;
    const mint = async (scenarioId: "synthetic-normal" | "synthetic-recovery") => {
      operationSequence += 1;
      output.length = 0;
      await authorizeLiveSimulatorRun({
        argv:
          scenarioId === "synthetic-recovery"
            ? ["--scenario", scenarioId, "--predecessor", "operation-abnormal-001"]
            : ["--scenario", scenarioId],
        configuration: {
          organizationId: "org-test",
          endpointAlias: "greenhouse-synthetic",
          authorizationAudience: "muster-live-simulator",
          authorizationSigningKey: signingKey,
          authorizedTargetDigest,
          publicBaseUrl: "https://simulator.invalid",
        },
        authorizationIssuer: {
          issue: vi.fn(async (value) => {
            issued.push(value);
            return { outcome: "issued", operationId: value.operationId };
          }),
        },
        predecessorLookup: {
          find: async () => ({
            scenarioId: "synthetic-abnormal",
            scenarioRevision: 2,
            terminal: true,
            hasEvidence: true,
            provenance: "SIMULATED",
          }),
        },
        scenarios: [
          { scenarioId: "synthetic-normal", revision: 2, supportedModes: ["LIVE_SMOKE"] },
          { scenarioId: "synthetic-recovery", revision: 2, supportedModes: ["LIVE_SMOKE"] },
        ],
        nowEpochSeconds: () => 1_786_464_000,
        generateOperationId: () => `operation-composition-${String(operationSequence)}`,
        generateNonce: () => `nonce-composition-${String(operationSequence)}`,
        writeOutput: (value) => output.push(value),
      });
      return JSON.parse(output[0]!) as { operationId: string; permit: string };
    };

    const durableOperations = new Map<string, Record<string, unknown>>();
    const queue: Array<{
      operationId: string;
      scenarioId: string;
      scenarioRevision: number;
      runAuthorization: string;
      predecessorOperationId?: string;
    }> = [];
    let predecessorEligible = true;
    const providerDispatch = vi.fn(async ({ operationId }: { operationId: string }) => ({
      providerCallId: `provider-${operationId}`,
      terminalStatus: "completed",
      observedAt: "2026-08-10T12:00:00.000Z",
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
            spokenUnitToken: spokenUnit,
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
    const persistAdmission = vi.fn(
      async (admission: { operationId: string; evidence: Record<string, unknown> }) => {
        durableOperations.set(admission.operationId, {
          operationId: admission.operationId,
          resourceVersion: 3,
          stage: "terminal",
          terminal: true,
          terminalOutcome: "observation_recorded",
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          provenance: "SIMULATED",
          transcript: admission.evidence["transcript"],
          evidence: { quality: "complete", opaqueReference: "custody-opaque-1" },
          readings: (admission.evidence["readings"] as Record<string, unknown>[]).map(
            (reading, index) => ({
              zoneId: reading["zoneId"],
              label: [
                "North house air temperature",
                "Propagation bench temperature",
                "Greenhouse relative humidity",
                "Irrigation reservoir level",
              ][index],
              value: reading["value"],
              unit: reading["normalizedUnit"],
              status: reading["status"],
              disposition: "grounded",
            }),
          ),
          reconciliation: ["zone-01", "zone-02", "zone-03", "zone-04"].map((zoneId) => ({
            zoneId,
            disposition: "matched",
          })),
          auxiliaryStatus: admission.evidence["auxiliaryStatus"],
          predecessorOperationId: null,
        });
      },
    );
    const runnerDependencies = {
      configuration: {
        runtimeProfile: "test",
        enabled: true,
        callBudget: 1,
        concurrency: 1,
        timeoutMs: 1_000,
        endpointAlias: "greenhouse-synthetic",
        authorizationAudience: "muster-live-simulator",
      },
      resolvedSecrets: { calleApiToken: "local-never-sent", targetAddress: "local-never-dialed" },
      authorizationBoundary: { reserve: async () => "reserved" as const },
      evidencePersistence: { persistAdmission },
      reviewedConfidenceTokens: ["provider-observed"],
      observability: { establishTraceContext: () => ({ traceparent }), record: vi.fn() },
      terminalAttempts: { recordFailure: vi.fn() },
      killSwitch: { assertDispatchAllowed: vi.fn() },
      dtmfSafetyStop: createDtmfSafetyStop(),
      dispatchAttempts: {
        claim: async ({ operationId }) => ({
          providerDispatchIdentity: `dispatch-${operationId}`,
          adapterVersionId: "adapter-v1",
        }),
      },
      resultPersistence: {
        commitAtomically: async (_value, canCommit) =>
          canCommit()
            ? {
                disposition: "committed" as const,
                winner: "observation_recorded" as const,
              }
            : { disposition: "blocked" as const },
      },
      dispatch: providerDispatch as never,
    } as const;
    const runner = createLiveSmokeRunner(runnerDependencies);
    const controller = createLiveSimulatorController({
      runtimeProfile: "test",
      enabled: true,
      scenarios: [
        { scenarioId: "synthetic-normal", revision: 2, supportedModes: ["LIVE_SMOKE"] },
        { scenarioId: "synthetic-recovery", revision: 2, supportedModes: ["LIVE_SMOKE"] },
      ],
      requestLiveObservation: async (request) => {
        const claims = verifyRunAuthorization({
          token: request.permit,
          signingKey,
          audience: "muster-live-simulator",
          endpointAlias: "greenhouse-synthetic",
          nowEpochSeconds: 1_786_464_001,
          authorizedTargetDigest,
          publicOrigin: "https://simulator.invalid",
        });
        if (
          claims.scenarioId !== request.scenarioId ||
          claims.scenarioRevision !== request.scenarioRevision ||
          (claims.predecessorOperationId !== null && !predecessorEligible)
        )
          throw ApplicationError.validation("live_authorization_invalid");
        durableOperations.set(claims.runId, {
          operationId: claims.runId,
          resourceVersion: 0,
          stage: "scheduled",
          terminal: false,
          terminalOutcome: null,
          scenarioId: claims.scenarioId,
          scenarioRevision: claims.scenarioRevision,
          provenance: "SIMULATED",
          transcript: [],
          evidence: null,
          readings: [],
          reconciliation: [],
          auxiliaryStatus: null,
          predecessorOperationId: claims.predecessorOperationId,
        });
        queue.push({
          operationId: claims.runId,
          scenarioId: claims.scenarioId,
          scenarioRevision: claims.scenarioRevision,
          runAuthorization: request.permit,
          ...(claims.predecessorOperationId === null
            ? {}
            : { predecessorOperationId: claims.predecessorOperationId }),
        });
        return { operationId: claims.runId, resourceVersion: 0 };
      },
      getLiveObservation: async (operationId) => durableOperations.get(operationId),
    });
    const http = await startSimulatorHostHttpRuntime({
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://simulator.invalid",
      allowedDemoOrigin: "http://127.0.0.1:4173",
      maxBodyBytes: 16_384,
      liveController: controller,
      twilioController: { voice: vi.fn(), canary: vi.fn() },
      establishTraceContext: () => ({ traceparent }),
    });

    try {
      const successful = await mint("synthetic-normal");
      const post = await fetch(`${http.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          permit: successful.permit,
        }),
      });
      expect(post.status).toBe(202);
      expect(durableOperations.has(successful.operationId)).toBe(true);
      await expect(runner.execute(queue.shift()!)).resolves.toMatchObject({ status: "completed" });
      expect(persistAdmission).toHaveBeenCalledOnce();
      const get = await fetch(
        `${http.baseUrl}/api/v1/live-simulator/operations/${successful.operationId}`,
      );
      await expect(get.json()).resolves.toMatchObject({
        operationId: successful.operationId,
        terminalOutcome: "observation_recorded",
        provenance: "SIMULATED",
      });

      const recovery = await mint("synthetic-recovery");
      predecessorEligible = false;
      const rejected = await fetch(`${http.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "synthetic-recovery",
          scenarioRevision: 2,
          permit: recovery.permit,
        }),
      });
      await expect(rejected.json()).resolves.toEqual({
        error: {
          code: "authorization_invalid",
          message: "Permit rejected. Mint a fresh scenario-bound permit.",
        },
      });
      expect(providerDispatch).toHaveBeenCalledOnce();

      const reservationFailure = await mint("synthetic-normal");
      const accepted = await fetch(`${http.baseUrl}/api/v1/live-simulator/operations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          permit: reservationFailure.permit,
        }),
      });
      expect(accepted.status).toBe(202);
      const reservationFailureRunner = createLiveSmokeRunner({
        ...runnerDependencies,
        authorizationBoundary: { reserve: async () => "invalid_predecessor" as never },
      });
      await expect(reservationFailureRunner.execute(queue.shift()!)).resolves.toMatchObject({
        status: "blocked",
        reason: "authorization_rejected",
      });
      expect(providerDispatch).toHaveBeenCalledOnce();
      expect(issued).toHaveLength(3);
    } finally {
      await http.close();
    }
  });
});

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";

import { createLiveSmokeCleanup } from "./twilio-live-smoke-control.js";
import { createLiveSmokeEvidenceCoordinator } from "./live-smoke-evidence-coordinator.js";

const organizationId = OrganizationId.create("org-review-remediation");
const callDigest = createHash("sha256").update("synthetic-call").digest("hex");
const traceId = "a".repeat(32);

describe("Phase 6 review remediation contracts", () => {
  it("lets only the durable dispatch-transition winner create and makes restart replay reconciliation-only", async () => {
    const api = (await import("./index.js")) as Record<string, CallableFunction>;
    expect(api["createDurableLiveSmokeDispatch"]).toBeTypeOf("function");
    let state: "reserved" | "dispatching" | "dispatched" = "reserved";
    const create = vi.fn(async () => "provider-output");
    const reconcile = vi.fn(async () => "provider-output");
    const repository = {
      claim: vi.fn(async () => {
        if (state !== "reserved") return { outcome: "reconcile" as const };
        state = "dispatching";
        return { outcome: "claimed" as const };
      }),
      recordDisposition: vi.fn(async () => {
        state = "dispatched";
      }),
    };
    const first = api["createDurableLiveSmokeDispatch"]!({ repository, create, reconcile });
    const restarted = api["createDurableLiveSmokeDispatch"]!({ repository, create, reconcile });

    await expect(first.execute({ operationId: "operation-review" })).resolves.toBe(
      "provider-output",
    );
    await expect(restarted.execute({ operationId: "operation-review" })).resolves.toBe(
      "provider-output",
    );
    expect(create).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("never rewrites a successful provider return as provider failure when disposition persistence rejects", async () => {
    const api = (await import("./index.js")) as Record<string, CallableFunction>;
    const protectedFailure = new Error("protected disposition repository detail");
    const create = vi.fn(async () => "provider-output");
    const recordDisposition = vi.fn(async () => {
      throw protectedFailure;
    });
    const dispatch = api["createDurableLiveSmokeDispatch"]!({
      repository: {
        claim: vi.fn(async () => ({ outcome: "claimed" as const })),
        recordDisposition,
      },
      create,
      reconcile: vi.fn(),
    });

    const failure = await dispatch
      .execute({ operationId: "operation-disposition-failed" })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "DurableLiveSmokeDispatchPersistenceError",
      message: "Live smoke dispatch persistence failed",
      reason: "application_persistence_failed",
    });
    expect(JSON.stringify(failure)).not.toContain(protectedFailure.message);
    expect(create).toHaveBeenCalledOnce();
    expect(recordDisposition).toHaveBeenCalledOnce();
    expect(recordDisposition).toHaveBeenCalledWith({
      operationId: "operation-disposition-failed",
      outcome: "provider_returned",
    });
  });

  it("admits CALL-E evidence before append and waits for durable callback plus reconciliation facts", async () => {
    const facts: Array<Record<string, unknown>> = [];
    let wake: (() => void) | undefined;
    const coordinator = createLiveSmokeEvidenceCoordinator({
      organizationId,
      providerFacts: {
        append: vi.fn(async (fact) => {
          facts.push({
            ...(fact as unknown as Record<string, unknown>),
            appendOrdinal: facts.length + 1,
          });
          wake?.();
          return { outcome: "appended" as const };
        }),
        listForOperation: vi.fn(async () => facts as never),
      },
      admitCalleEvidence: vi.fn(() => ({ outcome: "admissible" as const })),
      reconcile: vi.fn(async () => ({
        outcome: "one_matching_call" as const,
        inboundCallCount: 1,
      })),
      terminalAttempts: { recordFailure: vi.fn(async () => undefined) },
      closeRunGate: vi.fn(),
      waitForFact: (notify) => {
        wake = notify;
        return () => undefined;
      },
      now: (() => {
        const instants = ["2026-08-24T20:00:00.000Z", "2026-08-24T20:00:59.000Z"];
        return () => instants.shift() ?? "2026-08-24T20:00:59.000Z";
      })(),
    } as never);
    coordinator.begin({ organizationId, operationId: "operation-review", deadlineMs: 1_000 });
    const waiting = coordinator.waitUntilReady({ organizationId, operationId: "operation-review" });
    for (const [phase, outcome, actionsObserved] of [
      ["voice", "accepted", null],
      ["canary", "zero_dtmf", 0],
      ["status", "completed", null],
    ] as const) {
      facts.push({
        organizationId,
        operationId: "operation-review",
        phase,
        providerCallDigest: callDigest,
        semanticDigest: createHash("sha256").update(phase).digest("hex"),
        outcome,
        occurredAt: `2026-08-24T20:00:1${String(facts.length)}.000Z`,
        traceId,
        signatureValidated: true,
        actionsObserved,
        inboundCallCount: null,
        appendOrdinal: facts.length + 1,
      });
    }
    await coordinator.recordCalleTerminal({
      operationId: "operation-review",
      providerOutput: { terminalStatus: "completed" },
      traceId,
      providerCallDigest: callDigest,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    wake?.();
    await vi.waitFor(() => expect(facts.map((fact) => fact["phase"])).toContain("reconciliation"));
    expect(facts).toHaveLength(5);
    expect(facts.map((fact) => [fact["phase"], fact["outcome"]])).toEqual([
      ["voice", "accepted"],
      ["canary", "zero_dtmf"],
      ["status", "completed"],
      ["calle_terminal", "admissible"],
      ["reconciliation", "one_matching_call"],
    ]);
    await expect(waiting).resolves.toMatchObject({ outcome: "ready" });
    expect(facts.map((fact) => fact["phase"])).toContain("reconciliation");
  });

  it("cleanup closes first and never tears down host/tunnel unless resting Reject is verified", async () => {
    const order: string[] = [];
    const cleanup = createLiveSmokeCleanup({
      closeRunGate: () => order.push("close-gate"),
      awaitPreRestorationBarrier: async () => ({
        outcome: "ready" as const,
        proof: "zero_dispatch" as const,
      }),
      restoreTwilio: async () => order.push("restore"),
      verifyTwilioResting: async () => false,
      clearRuntimeSecrets: () => order.push("clear-secrets"),
      stopHost: async () => order.push("stop-host"),
      stopTunnel: async () => order.push("stop-tunnel"),
    });
    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    await cleanup.execute();
    expect(order).toEqual(["close-gate", "restore"]);
  });
});

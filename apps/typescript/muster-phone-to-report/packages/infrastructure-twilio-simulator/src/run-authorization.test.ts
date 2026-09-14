import { describe, expect, it } from "vitest";

import { OrganizationId } from "@muster/domain";

const organizationId = OrganizationId.create("org-run-authorization");
const exactSafetyClaims = Object.freeze({
  authorizedTargetDigest: "b".repeat(64),
  publicOrigin: "https://simulator.invalid",
  purpose: "non-production-synthetic-live-smoke" as const,
  callBudget: 1 as const,
  concurrency: 1 as const,
  retryBudget: 0 as const,
  dtmfPolicy: "forbidden" as const,
  terminalDeadlineSeconds: 120,
});

async function loadAuthorizationApi(): Promise<Record<string, (...args: never[]) => unknown>> {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as Record<
    string,
    (...args: never[]) => unknown
  >;
}

class TestAuthorizationStore {
  public async issue(input: { readonly operationId: string }): Promise<{
    readonly outcome: "issued";
    readonly operationId: string;
  }> {
    return { outcome: "issued", operationId: input.operationId };
  }

  public async bind(input: { readonly operationId: string }): Promise<{
    readonly outcome: "bound";
    readonly operationId: string;
  }> {
    return { outcome: "bound", operationId: input.operationId };
  }
}

type AtomicDisposition = "reserved" | "replayed" | "conflict" | "missing" | "expired";

class StatefulAtomicReservationStore extends TestAuthorizationStore {
  public readonly reservations: unknown[] = [];
  private readonly semantics = new Map<string, string>();

  public async reserve(input: {
    readonly nonceDigest: string;
    readonly semanticDigest: string;
    readonly operationId: string;
  }): Promise<{ readonly outcome: AtomicDisposition; readonly operationId?: string }> {
    this.reservations.push(input);
    const existing = this.semantics.get(input.nonceDigest);
    if (existing === undefined) {
      this.semantics.set(input.nonceDigest, input.semanticDigest);
      return { outcome: "reserved", operationId: input.operationId };
    }
    return existing === input.semanticDigest
      ? { outcome: "replayed", operationId: input.operationId }
      : { outcome: "conflict" };
  }
}

describe("run authorization", () => {
  it("persists every signed semantic claim including the exact recovery predecessor", async () => {
    const api = await loadAuthorizationApi();
    const issue = api["issueRunAuthorization"] as CallableFunction;
    const verify = api["verifyRunAuthorization"] as CallableFunction;
    const issuedRecords: unknown[] = [];
    const signingKey = "test-only-run-authorization-signing-key-32-bytes";
    const authorizationIssuer = {
      async issue(input: unknown): Promise<{ outcome: "issued"; operationId: string }> {
        issuedRecords.push(input);
        return { outcome: "issued", operationId: "operation-recovery-001" };
      },
    };

    const issued = (await issue({
      ...exactSafetyClaims,
      runId: "operation-recovery-001",
      scenarioId: "synthetic-recovery",
      scenarioRevision: 2,
      endpointAlias: "synthetic-demo-endpoint",
      audience: "muster-simulator-host",
      signingKey,
      nonce: "nonce-recovery-001",
      predecessorOperationId: "operation-abnormal-001",
      nowEpochSeconds: 1_786_000_000,
      ttlSeconds: 30,
      organizationId,
      authorizationIssuer,
    })) as { readonly token: string };

    expect(
      verify({
        token: issued.token,
        signingKey,
        audience: "muster-simulator-host",
        endpointAlias: "synthetic-demo-endpoint",
        nowEpochSeconds: 1_786_000_001,
      }),
    ).toMatchObject({
      runId: "operation-recovery-001",
      scenarioId: "synthetic-recovery",
      scenarioRevision: 2,
      predecessorOperationId: "operation-abnormal-001",
    });
    expect(issuedRecords).toEqual([
      expect.objectContaining({
        operationId: "operation-recovery-001",
        scenarioId: "synthetic-recovery",
        scenarioRevision: 2,
        audience: "muster-simulator-host",
        endpointAlias: "synthetic-demo-endpoint",
        predecessorOperationId: "operation-abnormal-001",
        nonceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        semanticDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);
    expect(JSON.stringify(issuedRecords)).not.toContain("nonce-recovery-001");
    expect(JSON.stringify(issuedRecords)).not.toContain(issued.token);
  });

  it("rejects non-finite, fractional, future-issued, and exact-expiry clock values", async () => {
    const api = await loadAuthorizationApi();
    const issue = api["issueRunAuthorization"] as CallableFunction;
    const verify = api["verifyRunAuthorization"] as CallableFunction;
    const signingKey = "test-only-run-authorization-signing-key-32-bytes";
    const issued = (await issue({
      ...exactSafetyClaims,
      runId: "run-clock-boundary",
      scenarioId: "synthetic-normal",
      scenarioRevision: 1,
      endpointAlias: "synthetic-demo-endpoint",
      audience: "muster-twilio-simulator",
      signingKey,
      nonce: "nonce-clock-boundary",
      nowEpochSeconds: 1_786_000_000,
      ttlSeconds: 10,
      organizationId,
      authorizationIssuer: new TestAuthorizationStore(),
    })) as { readonly token: string };
    const verification = {
      token: issued.token,
      signingKey,
      audience: "muster-twilio-simulator",
      endpointAlias: "synthetic-demo-endpoint",
    };

    for (const nowEpochSeconds of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1_786_000_000.5,
    ]) {
      expect(() => verify({ ...verification, nowEpochSeconds })).toThrow(
        "Invalid run authorization: nowEpochSeconds",
      );
    }
    expect(() => verify({ ...verification, nowEpochSeconds: 1_785_999_999 })).toThrow(
      "Invalid run authorization: claims",
    );
    expect(() => verify({ ...verification, nowEpochSeconds: 1_786_000_010 })).toThrow(
      "Invalid run authorization: claims",
    );
  });

  it("atomically reserves valid signed exact claims once and rejects altered claims before storage", async () => {
    const api = await loadAuthorizationApi();
    const issue = api["issueRunAuthorization"] as CallableFunction;
    const createBoundary = api["createRunAuthorizationReservationBoundary"] as CallableFunction;
    const signingKey = "test-only-run-authorization-signing-key-32-bytes";
    const store = new StatefulAtomicReservationStore();
    const token = (await issue({
      ...exactSafetyClaims,
      runId: "run-atomic-boundary",
      scenarioId: "synthetic-normal",
      scenarioRevision: 1,
      endpointAlias: "synthetic-demo-endpoint",
      audience: "muster-twilio-simulator",
      signingKey,
      nonce: "nonce-atomic-boundary",
      nowEpochSeconds: 1_786_000_000,
      ttlSeconds: 30,
      organizationId,
      authorizationIssuer: store,
    })) as { readonly token: string };
    const boundary = createBoundary({
      authorizedTargetDigest: exactSafetyClaims.authorizedTargetDigest,
      publicOrigin: exactSafetyClaims.publicOrigin,
      signingKey,
      audience: "muster-twilio-simulator",
      endpointAlias: "synthetic-demo-endpoint",
      organizationId,
      authorizationReservations: store,
      nowEpochSeconds: () => 1_786_000_001,
    }) as { reserve(input: unknown): Promise<AtomicDisposition> };
    const exact = {
      token: token.token,
      runId: "run-atomic-boundary",
      scenarioId: "synthetic-normal",
      scenarioRevision: 1,
      audience: "muster-twilio-simulator",
      endpointAlias: "synthetic-demo-endpoint",
    };

    await expect(boundary.reserve(exact)).resolves.toBe("reserved");
    await expect(boundary.reserve(exact)).resolves.toBe("replayed");
    expect(store.reservations).toHaveLength(2);
    expect(store.reservations[0]).toMatchObject({
      organizationId,
      operationId: "run-atomic-boundary",
      now: "2026-08-06T07:06:41.000Z",
      nonceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      semanticDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });

    const rejected = [
      { ...exact, token: `${token.token.slice(0, -1)}x` },
      { ...exact, runId: "run-changed" },
      { ...exact, scenarioId: "synthetic-abnormal" },
      { ...exact, scenarioRevision: 2 },
      { ...exact, audience: "different-audience" },
      { ...exact, endpointAlias: "different-endpoint" },
    ];
    for (const request of rejected) {
      await expect(boundary.reserve(request)).resolves.toBe("conflict");
    }
    expect(store.reservations).toHaveLength(2);

    const first = store.reservations[0] as {
      readonly nonceDigest: string;
      readonly semanticDigest: string;
      readonly operationId: string;
    };
    await expect(
      store.reserve({ ...first, semanticDigest: "f".repeat(64) }),
    ).resolves.toMatchObject({ outcome: "conflict" });
  });
});

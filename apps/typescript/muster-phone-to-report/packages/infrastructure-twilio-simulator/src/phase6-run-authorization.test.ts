import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";

import { issueRunAuthorization, verifyRunAuthorization } from "./run-authorization.js";

const organizationId = OrganizationId.create("org-phase6-authorization");
const signingKey = "test-only-run-authorization-signing-key-32-bytes";
const exactClaims = Object.freeze({
  authorizedTargetDigest: "b".repeat(64),
  publicOrigin: "https://phase6.invalid",
  purpose: "non-production-synthetic-live-smoke" as const,
  callBudget: 1 as const,
  concurrency: 1 as const,
  retryBudget: 0 as const,
  dtmfPolicy: "forbidden" as const,
  terminalDeadlineSeconds: 120,
});

function issue(overrides: Readonly<Record<string, unknown>> = {}) {
  return issueRunAuthorization({
    organizationId,
    runId: "operation-phase6-authorization",
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    endpointAlias: "greenhouse-synthetic",
    audience: "muster-live-simulator",
    signingKey,
    nonce: "nonce-phase6-authorization",
    predecessorOperationId: null,
    nowEpochSeconds: 1_787_600_000,
    ttlSeconds: 300,
    authorizationIssuer: { issue: vi.fn(async () => ({ outcome: "issued", operationId: "x" })) },
    ...exactClaims,
    ...overrides,
  } as never);
}

describe("Phase 6 exact one-use run authorization", () => {
  it("AC-HAPPY-10 signs every target, origin, budget, and safety claim without assuming a caller", async () => {
    const authorizationIssuer = {
      issue: vi.fn(async () => ({
        outcome: "issued" as const,
        operationId: "operation-phase6-authorization",
      })),
    };
    const authorization = await issue({ authorizationIssuer });
    const claims = verifyRunAuthorization({
      token: authorization.token,
      signingKey,
      audience: "muster-live-simulator",
      endpointAlias: "greenhouse-synthetic",
      nowEpochSeconds: 1_787_600_001,
      ...exactClaims,
    } as never) as unknown as Readonly<Record<string, unknown>>;

    expect(claims).toMatchObject(exactClaims);
    expect(claims).not.toHaveProperty("expectedCallerDigest");
    expect(authorizationIssuer.issue).toHaveBeenCalledWith(expect.objectContaining(exactClaims));
    expect(authorizationIssuer.issue).toHaveBeenCalledWith(
      expect.not.objectContaining({ expectedCallerDigest: expect.anything() }),
    );
  });

  it("AC-HAPPY-10 rejects a missing target digest, more than 120 seconds, and non-zero retry", async () => {
    await expect(issue({ authorizedTargetDigest: undefined })).rejects.toThrowError(
      /Invalid run authorization/u,
    );
    await expect(issue({ terminalDeadlineSeconds: 121 })).rejects.toThrowError(
      /Invalid run authorization/u,
    );
    await expect(issue({ retryBudget: 1 })).rejects.toThrowError(/Invalid run authorization/u);
  });

  it("AC-ERROR-7 permanently binds one consumed authorization to its exact safety semantics", async () => {
    const authorization = await issue();
    expect(() =>
      verifyRunAuthorization({
        token: authorization.token,
        signingKey,
        audience: "muster-live-simulator",
        endpointAlias: "greenhouse-synthetic",
        nowEpochSeconds: 1_787_600_001,
        ...exactClaims,
        publicOrigin: "https://different.invalid",
      } as never),
    ).toThrowError(/Invalid run authorization/u);
  });
});

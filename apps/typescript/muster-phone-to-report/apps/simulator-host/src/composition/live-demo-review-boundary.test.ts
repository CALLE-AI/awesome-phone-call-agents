import { describe, expect, it, vi } from "vitest";

interface BoundaryModule {
  readonly LIVE_DEMO_REVIEW_ROUTE_TABLE: readonly Readonly<{
    kind: "operation" | "cleanup";
    method: "GET" | "DELETE";
    route: string;
  }>[];
  classifyLiveDemoReviewRequest(
    input: Readonly<{
      method: string | undefined;
      path: string;
      exactOperationPath: string;
      exactCleanupPath: string;
    }>,
  ): Readonly<{
    outcome: "operation" | "cleanup" | "options" | "method_not_allowed" | "not_found";
    method: "GET" | "DELETE" | "OPTIONS" | "OTHER";
    route?: string;
  }>;
}

async function boundaryModule(): Promise<BoundaryModule> {
  const moduleUrl = new URL("./live-demo-review-boundary.ts", import.meta.url).href;
  return (await import(/* @vite-ignore */ moduleUrl)) as BoundaryModule;
}

describe("immutable provider-free Demo Review boundary", () => {
  it("exports only the closed exact-operation and exact-session route table", async () => {
    const { LIVE_DEMO_REVIEW_ROUTE_TABLE } = await boundaryModule();
    expect(Object.isFrozen(LIVE_DEMO_REVIEW_ROUTE_TABLE)).toBe(true);
    expect(LIVE_DEMO_REVIEW_ROUTE_TABLE).toEqual([
      {
        kind: "operation",
        method: "GET",
        route: "GET /api/v1/live-simulator/operations/{operationId}",
      },
      {
        kind: "cleanup",
        method: "DELETE",
        route: "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
      },
    ]);
  });

  it.each([
    ["GET", "/exact-operation", "operation", "GET"],
    ["DELETE", "/exact-cleanup", "cleanup", "DELETE"],
    ["OPTIONS", "/exact-operation", "options", "OPTIONS"],
    ["POST", "/exact-operation", "method_not_allowed", "OTHER"],
    ["GET", "/hidden", "not_found", "GET"],
  ] as const)(
    "classifies %s %s through the closed dispatcher",
    async (method, path, outcome, normalizedMethod) => {
      const { classifyLiveDemoReviewRequest } = await boundaryModule();
      expect(
        classifyLiveDemoReviewRequest({
          method,
          path,
          exactOperationPath: "/exact-operation",
          exactCleanupPath: "/exact-cleanup",
        }),
      ).toMatchObject({ outcome, method: normalizedMethod });
    },
  );

  it("owns the immutable protected cleanup transition before invoking cleanup resources", async () => {
    const { createLiveDemoReviewProtectedCleanupBinding } = (await import(
      /* @vite-ignore */ new URL("./live-demo-review-boundary.ts", import.meta.url).href
    )) as typeof import("./live-demo-review-boundary.js");
    const loadCheckpoint = vi.fn(async () => undefined);
    const transitionReviewCleanup = vi.fn(async () => Object.freeze({ outcome: "conflict" }));
    const binding = createLiveDemoReviewProtectedCleanupBinding({
      cleanupOwner: {
        session: {
          sessionId: "review-session",
          operationId: "operation-review",
          scenarioId: "synthetic-normal",
          scenarioRevision: 1,
          reviewReadyAt: "2026-09-02T12:00:00.000Z",
          reviewExpiresAt: "2026-09-02T12:30:00.000Z",
          custodyOwnershipDigest: "b".repeat(64),
          databaseOwnershipDigest: "c".repeat(64),
        },
        cleanupOwnerDigest: "a".repeat(64),
        loadCheckpoint,
        compareAndSetCheckpoint: vi.fn(),
        attestCustodyOwnership: vi.fn(),
        attestDatabaseOwnership: vi.fn(),
        deleteCustodyRoot: vi.fn(),
        teardownDisposableDatabase: vi.fn(),
        verifyDisposableDatabaseDeleted: vi.fn(),
        authorizeStaleOwnerTakeover: vi.fn(),
        removeRecoveryCheckpoint: vi.fn(),
      },
      readReviewCleanupState: async () => "ready",
      transitionReviewCleanup,
    });

    expect(Object.isFrozen(binding)).toBe(true);
    binding.establishDatabaseLease();
    await expect(binding.cleanup("finish")).resolves.toMatchObject({
      outcome: "blocked",
      message: "Cleanup requires attention",
    });
    expect(transitionReviewCleanup).toHaveBeenCalledWith("ready", "cleanup_pending");
    expect(loadCheckpoint).not.toHaveBeenCalled();
  });
});

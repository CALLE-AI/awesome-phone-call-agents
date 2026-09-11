import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createLiveDemoReviewCleanupOwner,
  type LiveDemoReviewCleanupCheckpoint,
  type LiveDemoReviewCleanupOwnerInput,
} from "./live-demo-review-session.js";
import { createLiveDemoReviewCheckpointStore } from "./live-demo-review-checkpoint-store.js";

const exactSession = Object.freeze({
  sessionId: "review-session-001",
  operationId: "operation-review-001",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
  reviewReadyAt: "2026-09-01T16:00:00.000Z",
  reviewExpiresAt: "2026-09-01T16:30:00.000Z",
  custodyOwnershipDigest: "a".repeat(64),
  databaseOwnershipDigest: "b".repeat(64),
});

function createHarness(
  checkpoint?: LiveDemoReviewCleanupCheckpoint,
  overrides: Partial<{
    attestCustodyOwnership: LiveDemoReviewCleanupOwnerInput["attestCustodyOwnership"];
    attestDatabaseOwnership: LiveDemoReviewCleanupOwnerInput["attestDatabaseOwnership"];
    deleteCustodyRoot: () => Promise<void>;
    teardownDisposableDatabase: LiveDemoReviewCleanupOwnerInput["teardownDisposableDatabase"];
    verifyDisposableDatabaseDeleted: () => Promise<boolean>;
    authorizeStaleOwnerTakeover: LiveDemoReviewCleanupOwnerInput["authorizeStaleOwnerTakeover"];
    removeRecoveryCheckpoint: () => Promise<void>;
  }> = {},
) {
  let current = checkpoint;
  const persisted: LiveDemoReviewCleanupCheckpoint[] = [];
  const events: string[] = [];
  const owner = createLiveDemoReviewCleanupOwner({
    session: exactSession,
    cleanupOwnerDigest: "c".repeat(64),
    loadCheckpoint: async () => current,
    compareAndSetCheckpoint: async (request) => {
      if ((current?.version ?? null) !== request.expectedVersion) {
        return { outcome: "conflict" as const, checkpoint: current };
      }
      current = Object.freeze({
        ...request.checkpoint,
        version: (request.expectedVersion ?? 0) + 1,
        cleanupOwnerDigest: request.cleanupOwnerDigest,
      });
      persisted.push(current);
      return { outcome: "updated" as const, checkpoint: current };
    },
    attestCustodyOwnership:
      overrides.attestCustodyOwnership ??
      (async () => ({
        outcome: "owned" as const,
        sessionId: exactSession.sessionId,
        ownershipDigest: exactSession.custodyOwnershipDigest,
        exclusive: true as const,
      })),
    attestDatabaseOwnership:
      overrides.attestDatabaseOwnership ??
      (async () => ({
        outcome: "owned" as const,
        sessionId: exactSession.sessionId,
        ownershipDigest: exactSession.databaseOwnershipDigest,
        exclusive: true as const,
      })),
    deleteCustodyRoot:
      overrides.deleteCustodyRoot ??
      (async () => {
        events.push("custody-deleted");
      }),
    teardownDisposableDatabase:
      overrides.teardownDisposableDatabase ??
      (async () => {
        events.push("database-deleted");
        return { outcome: "deleted" as const };
      }),
    verifyDisposableDatabaseDeleted:
      overrides.verifyDisposableDatabaseDeleted ?? (async () => true),
    authorizeStaleOwnerTakeover: overrides.authorizeStaleOwnerTakeover ?? (async () => false),
    removeRecoveryCheckpoint:
      overrides.removeRecoveryCheckpoint ??
      (async () => {
        events.push("checkpoint-removed");
      }),
  });
  return { owner, persisted, events, checkpoint: () => current };
}

describe("live demo exact-session cleanup owner", () => {
  it("deletes exact custody before its attested disposable database and reports success once", async () => {
    const harness = createHarness();

    await expect(harness.owner.cleanup("finish")).resolves.toEqual({
      outcome: "deleted",
      message: "Protected demo result deleted",
    });
    expect(harness.events).toEqual(["custody-deleted", "database-deleted", "checkpoint-removed"]);
    expect(harness.checkpoint()).toMatchObject({
      state: "review_deleted",
      custodyDeleted: true,
      databaseDeleted: true,
      recoveryIdentity: null,
      version: 4,
    });
  });

  it.each(["finish", "ttl", "interrupt", "restart"] as const)(
    "uses the same exact cleanup owner for %s",
    async (trigger) => {
      const harness = createHarness();
      await expect(harness.owner.cleanup(trigger)).resolves.toMatchObject({ outcome: "deleted" });
      expect(harness.checkpoint()).toMatchObject({ trigger, state: "review_deleted" });
    },
  );

  it("memoizes concurrent Finish and TTL requests into one destructive execution", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deleteCustodyRoot = vi.fn(async () => await blocked);
    const teardownDisposableDatabase = vi.fn(async () => ({ outcome: "deleted" as const }));
    const harness = createHarness(undefined, { deleteCustodyRoot, teardownDisposableDatabase });

    const finish = harness.owner.cleanup("finish");
    const ttl = harness.owner.cleanup("ttl");
    release();

    await expect(Promise.all([finish, ttl])).resolves.toEqual([
      { outcome: "deleted", message: "Protected demo result deleted" },
      { outcome: "deleted", message: "Protected demo result deleted" },
    ]);
    expect(deleteCustodyRoot).toHaveBeenCalledOnce();
    expect(teardownDisposableDatabase).toHaveBeenCalledOnce();
  });

  it("keeps a bounded recovery identity and a truthful blocked state after custody failure", async () => {
    const harness = createHarness(undefined, {
      deleteCustodyRoot: vi.fn(async () => {
        throw new Error("synthetic custody refusal");
      }),
    });

    await expect(harness.owner.cleanup("finish")).resolves.toEqual({
      outcome: "blocked",
      message: "Cleanup requires attention",
      recoveryIdentity: exactSession,
    });
    expect(harness.events).toEqual([]);
    expect(harness.checkpoint()).toMatchObject({
      state: "review_cleanup_blocked",
      custodyDeleted: false,
      databaseDeleted: false,
      recoveryIdentity: exactSession,
    });
  });

  it("resumes a partial checkpoint without replaying custody deletion", async () => {
    const deleteCustodyRoot = vi.fn(async () => undefined);
    const teardownDisposableDatabase = vi.fn(async () => ({ outcome: "deleted" as const }));
    const harness = createHarness(
      {
        session: exactSession,
        version: 3,
        cleanupOwnerDigest: "d".repeat(64),
        state: "review_cleanup_blocked",
        trigger: "ttl",
        custodyDeleted: true,
        databaseDeleted: false,
        recoveryIdentity: exactSession,
      },
      {
        deleteCustodyRoot,
        teardownDisposableDatabase,
        authorizeStaleOwnerTakeover: async () => true,
      },
    );

    await expect(harness.owner.cleanup("restart")).resolves.toMatchObject({ outcome: "deleted" });
    expect(deleteCustodyRoot).not.toHaveBeenCalled();
    expect(teardownDisposableDatabase).toHaveBeenCalledOnce();
    expect(harness.checkpoint()?.recoveryIdentity).toBeNull();
  });

  it("validates complete exact identity and checkpoint invariants before honoring review_deleted", async () => {
    const foreignSession = Object.freeze({
      ...exactSession,
      sessionId: "foreign-review-session",
    });
    const harness = createHarness({
      session: foreignSession,
      version: 7,
      cleanupOwnerDigest: "d".repeat(64),
      state: "review_deleted",
      trigger: "finish",
      custodyDeleted: true,
      databaseDeleted: true,
      recoveryIdentity: null,
    });

    await expect(harness.owner.cleanup("restart")).resolves.toEqual({
      outcome: "blocked",
      message: "Cleanup requires attention",
      recoveryIdentity: exactSession,
    });
    expect(harness.events).toEqual([]);
  });

  it("uses a durable CAS claim so concurrent process owners cannot both delete resources", async () => {
    let checkpoint: LiveDemoReviewCleanupCheckpoint | undefined;
    let release!: () => void;
    const custodyBlocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compareAndSetCheckpoint: LiveDemoReviewCleanupOwnerInput["compareAndSetCheckpoint"] =
      vi.fn(async (request) => {
        if ((checkpoint?.version ?? null) !== request.expectedVersion) {
          return { outcome: "conflict" as const, checkpoint };
        }
        const updated = Object.freeze({
          ...request.checkpoint,
          version: (request.expectedVersion ?? 0) + 1,
          cleanupOwnerDigest: request.cleanupOwnerDigest,
        });
        checkpoint = updated;
        return { outcome: "updated" as const, checkpoint: updated };
      });
    const deleteCustodyRoot = vi.fn(async () => await custodyBlocked);
    const teardownDisposableDatabase = vi.fn(async () => ({ outcome: "deleted" as const }));
    const createOwner = (cleanupOwnerDigest: string) =>
      createLiveDemoReviewCleanupOwner({
        session: exactSession,
        cleanupOwnerDigest,
        loadCheckpoint: async () => checkpoint,
        compareAndSetCheckpoint,
        attestCustodyOwnership: async () => ({
          outcome: "owned" as const,
          sessionId: exactSession.sessionId,
          ownershipDigest: exactSession.custodyOwnershipDigest,
          exclusive: true as const,
        }),
        attestDatabaseOwnership: async () => ({
          outcome: "owned" as const,
          sessionId: exactSession.sessionId,
          ownershipDigest: exactSession.databaseOwnershipDigest,
          exclusive: true as const,
        }),
        deleteCustodyRoot,
        teardownDisposableDatabase,
        verifyDisposableDatabaseDeleted: async () => true,
        authorizeStaleOwnerTakeover: async () => false,
        removeRecoveryCheckpoint: async () => undefined,
      });

    const first = createOwner("1".repeat(64)).cleanup("finish");
    await vi.waitFor(() => expect(deleteCustodyRoot).toHaveBeenCalledOnce());
    const second = createOwner("2".repeat(64)).cleanup("ttl");
    await expect(second).resolves.toMatchObject({ outcome: "blocked" });
    release();
    await expect(first).resolves.toMatchObject({ outcome: "deleted" });
    expect(deleteCustodyRoot).toHaveBeenCalledOnce();
    expect(teardownDisposableDatabase).toHaveBeenCalledOnce();
  });

  it("writes the final supervisor checkpoint only after disposable database teardown", async () => {
    const harness = createHarness();

    await expect(harness.owner.cleanup("finish")).resolves.toMatchObject({ outcome: "deleted" });
    const final = harness.persisted.at(-1);
    expect(final).toMatchObject({
      state: "review_deleted",
      custodyDeleted: true,
      databaseDeleted: true,
      recoveryIdentity: null,
    });
    expect(harness.events).toEqual(["custody-deleted", "database-deleted", "checkpoint-removed"]);
  });

  it.each([
    [
      "custody",
      async () => ({ outcome: "shared" as const }),
      async () => ({
        outcome: "owned" as const,
        sessionId: exactSession.sessionId,
        ownershipDigest: exactSession.databaseOwnershipDigest,
        exclusive: true as const,
      }),
    ],
    [
      "database",
      async () => ({
        outcome: "owned" as const,
        sessionId: exactSession.sessionId,
        ownershipDigest: exactSession.custodyOwnershipDigest,
        exclusive: true as const,
      }),
      async () => ({ outcome: "indeterminate" as const }),
    ],
  ])(
    "refuses %s teardown when exact ownership cannot be attested",
    async (_name, custody, database) => {
      const deleteCustodyRoot = vi.fn(async () => undefined);
      const teardownDisposableDatabase = vi.fn(async () => ({ outcome: "deleted" as const }));
      const harness = createHarness(undefined, {
        attestCustodyOwnership: custody,
        attestDatabaseOwnership: database,
        deleteCustodyRoot,
        teardownDisposableDatabase,
      });

      await expect(harness.owner.cleanup("restart")).resolves.toMatchObject({
        outcome: "blocked",
        message: "Cleanup requires attention",
        recoveryIdentity: exactSession,
      });
      if (_name === "custody") expect(deleteCustodyRoot).not.toHaveBeenCalled();
      else expect(deleteCustodyRoot).toHaveBeenCalledOnce();
      expect(teardownDisposableDatabase).not.toHaveBeenCalled();
    },
  );

  it("reads session-specific ownership markers immediately before each destructive action and verifies database deletion", async () => {
    const events: string[] = [];
    const harness = createHarness(undefined, {
      attestCustodyOwnership: async () => {
        events.push("custody-marker-read");
        return {
          outcome: "owned" as const,
          sessionId: exactSession.sessionId,
          ownershipDigest: exactSession.custodyOwnershipDigest,
          exclusive: true as const,
        };
      },
      deleteCustodyRoot: async () => {
        events.push("custody-deleted");
      },
      attestDatabaseOwnership: async () => {
        events.push("database-marker-read");
        return {
          outcome: "owned" as const,
          sessionId: exactSession.sessionId,
          ownershipDigest: exactSession.databaseOwnershipDigest,
          exclusive: true as const,
        };
      },
      teardownDisposableDatabase: async () => {
        events.push("database-owner-teardown");
        return { outcome: "deleted" as const };
      },
      verifyDisposableDatabaseDeleted: async () => {
        events.push("database-deletion-verified");
        return true;
      },
    });

    await expect(harness.owner.cleanup("finish")).resolves.toMatchObject({ outcome: "deleted" });
    expect(events).toEqual([
      "custody-marker-read",
      "custody-deleted",
      "database-marker-read",
      "database-owner-teardown",
      "database-deletion-verified",
    ]);
  });

  it("takes over a stale pending cleanup only with positive prior-owner-stopped evidence", async () => {
    const staleCheckpoint: LiveDemoReviewCleanupCheckpoint = {
      session: exactSession,
      version: 3,
      cleanupOwnerDigest: "d".repeat(64),
      state: "review_cleanup_pending",
      trigger: "interrupt",
      custodyDeleted: false,
      databaseDeleted: false,
      recoveryIdentity: exactSession,
    };
    const denied = createHarness(staleCheckpoint);
    await expect(denied.owner.cleanup("restart")).resolves.toMatchObject({ outcome: "blocked" });
    expect(denied.events).toEqual([]);

    const authorized = createHarness(staleCheckpoint, {
      authorizeStaleOwnerTakeover: async (checkpoint) =>
        checkpoint.cleanupOwnerDigest === "d".repeat(64),
    });
    await expect(authorized.owner.cleanup("restart")).resolves.toMatchObject({
      outcome: "deleted",
    });
  });

  it("scopes recovery checkpoints per exact session and permits two consecutive sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "muster-review-checkpoints-"));
    type RemovableCheckpointStore = ReturnType<typeof createLiveDemoReviewCheckpointStore> & {
      removeExactRecoveryIdentity(): Promise<void>;
    };
    try {
      for (const [sessionId, operationId] of [
        ["review-session-first", "operation-first"],
        ["review-session-second", "operation-second"],
      ] as const) {
        const store = createLiveDemoReviewCheckpointStore({
          rootDirectory: root,
          sessionId,
          operationId,
        }) as RemovableCheckpointStore;
        const session = { ...exactSession, sessionId, operationId };
        await expect(
          store.compareAndSet({
            expectedVersion: null,
            cleanupOwnerDigest: "c".repeat(64),
            checkpoint: {
              session,
              state: "review_ready",
              trigger: "restart",
              custodyDeleted: false,
              databaseDeleted: false,
              recoveryIdentity: session,
            },
          }),
        ).resolves.toMatchObject({ outcome: "updated" });
        await expect(store.removeExactRecoveryIdentity()).resolves.toBeUndefined();
        await expect(store.load()).resolves.toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

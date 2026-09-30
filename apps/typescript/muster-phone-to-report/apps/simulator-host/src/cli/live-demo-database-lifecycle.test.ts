import path from "node:path";

import { describe, expect, it, vi } from "vitest";

interface LifecycleApi {
  readonly LIVE_DEMO_DATABASE_ATTENTION_MESSAGE: string;
  beginLiveDemoDatabaseLifecycle(input: {
    readonly sessionId: string;
    readonly createdAt: string;
    readonly containerIntent: unknown;
    readonly statePublication: StatePublication;
  }): Promise<Record<string, unknown>>;
  persistLiveDemoDatabaseLifecycleTransition(input: {
    readonly current: unknown;
    readonly next: unknown;
    readonly statePublication: StatePublication;
  }): Promise<Record<string, unknown>>;
  publishLiveDemoDatabaseArtifacts(input: {
    readonly repositoryRoot: string;
    readonly current: unknown;
    readonly databaseUrl: string;
    readonly provisioningAttestationJson: string;
    readonly statePublication: StatePublication;
    readonly artifactPublication: ArtifactPublication;
  }): Promise<Record<string, unknown>>;
}

interface StatePublication {
  createExclusive(serializedState: string): Promise<boolean>;
  replaceAtomically(input: {
    readonly expectedSerializedState: string;
    readonly nextSerializedState: string;
  }): Promise<boolean>;
}

interface ArtifactPublication {
  stage(artifacts: readonly Readonly<{ path: string; contents: string }>[]): Promise<object>;
  setOwnerOnlyPermissions(staged: object): Promise<void>;
  verifyOwnerOnlyPermissions(staged: object): Promise<boolean>;
  publishAtomically(staged: object): Promise<void>;
  discard(staged: object): Promise<void>;
}

async function loadApi(): Promise<LifecycleApi> {
  return (await import("./live-demo-database-lifecycle.js")) as LifecycleApi;
}

const sessionId = "018f7d34-3e12-7f3b-8c9d-123456789abc";
const createdAt = "2026-09-03T17:00:00.000Z";
const image =
  "postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const ownershipToken = "A".repeat(43);

function containerIntent(): Record<string, unknown> {
  return {
    name: `muster-live-demo-database-${sessionId}`,
    image,
    ownershipToken,
    labels: {
      "com.muster.live-demo-database.session": sessionId,
      "com.muster.live-demo-database.owner": ownershipToken,
    },
    binding: { host: "127.0.0.1", hostPort: 54321, containerPort: 5432 },
    storage: "tmpfs",
  };
}

function databaseOwnedState(): Record<string, unknown> {
  return {
    version: 1,
    revision: 2,
    status: "starting",
    checkpoint: "database_owned",
    session: { id: sessionId, createdAt },
    containerIntent: containerIntent(),
    container: {
      id: "a".repeat(64),
      name: `muster-live-demo-database-${sessionId}`,
      image,
      ownershipToken,
      labels: {
        "com.muster.live-demo-database.session": sessionId,
        "com.muster.live-demo-database.owner": ownershipToken,
      },
      binding: { host: "127.0.0.1", hostPort: 54321, containerPort: 5432 },
      storage: "tmpfs",
    },
    database: {
      databaseName: "muster_live_demo_a1b2c3d4",
      databaseOwner: "muster_live_demo_owner_a1b2c3d4",
      provisioningOwnershipDigest: "b".repeat(64),
      attestationVersion: 1,
    },
  };
}

function statePublication(overrides: Partial<StatePublication> = {}): StatePublication {
  return {
    createExclusive: vi.fn(async () => true),
    replaceAtomically: vi.fn(async () => true),
    ...overrides,
  };
}

function artifactPublication(
  overrides: Partial<ArtifactPublication> = {},
): ArtifactPublication & { readonly staged: object } {
  const staged = Object.freeze({ stagingId: "opaque-stage" });
  return {
    staged,
    stage: vi.fn(async () => staged),
    setOwnerOnlyPermissions: vi.fn(async () => undefined),
    verifyOwnerOnlyPermissions: vi.fn(async () => true),
    publishAtomically: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("disposable live-demo database lifecycle publication", () => {
  it("creates the initial state with an exclusive atomic publication", async () => {
    const api = await loadApi();
    const publication = statePublication();

    const result = await api.beginLiveDemoDatabaseLifecycle({
      sessionId,
      createdAt,
      containerIntent: containerIntent(),
      statePublication: publication,
    });

    expect(result).toMatchObject({ outcome: "started", state: { revision: 0 } });
    expect(publication.createExclusive).toHaveBeenCalledOnce();
    expect(
      JSON.parse(vi.mocked(publication.createExclusive).mock.calls[0]?.[0] ?? "null"),
    ).toMatchObject({
      version: 1,
      status: "starting",
      checkpoint: "state_created",
      session: { id: sessionId },
    });
  });

  it("refuses a second or unresolved session without replacing the existing state", async () => {
    const api = await loadApi();
    const publication = statePublication({ createExclusive: vi.fn(async () => false) });

    await expect(
      api.beginLiveDemoDatabaseLifecycle({
        sessionId,
        createdAt,
        containerIntent: containerIntent(),
        statePublication: publication,
      }),
    ).resolves.toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(publication.replaceAtomically).not.toHaveBeenCalled();
  });

  it("uses exact compare-and-replace content and fails closed on a stale transition", async () => {
    const api = await loadApi();
    const current = databaseOwnedState();
    const next = { ...current, revision: 3, status: "ready", checkpoint: "artifacts_published" };
    const publication = statePublication({ replaceAtomically: vi.fn(async () => false) });

    await expect(
      api.persistLiveDemoDatabaseLifecycleTransition({
        current,
        next,
        statePublication: publication,
      }),
    ).resolves.toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(publication.replaceAtomically).toHaveBeenCalledWith({
      expectedSerializedState: `${JSON.stringify(current)}\n`,
      nextSerializedState: `${JSON.stringify(next)}\n`,
    });
  });

  it("publishes protected artifacts only after owner-only permission verification", async () => {
    const api = await loadApi();
    const order: string[] = [];
    const publication = statePublication({
      replaceAtomically: vi.fn(async () => {
        order.push("state-ready");
        return true;
      }),
    });
    const artifacts = artifactPublication({
      stage: vi.fn(async () => {
        order.push("stage");
        return Object.freeze({ stagingId: "opaque-stage" });
      }),
      setOwnerOnlyPermissions: vi.fn(async () => {
        order.push("protect");
      }),
      verifyOwnerOnlyPermissions: vi.fn(async () => {
        order.push("verify");
        return true;
      }),
      publishAtomically: vi.fn(async () => {
        order.push("publish");
      }),
    });
    const repositoryRoot = path.resolve("fixture-repository");
    const databaseUrl = "postgresql://demo:super-secret@127.0.0.1:54321/muster_live_demo_a1b2c3d4";
    const provisioningAttestationJson = JSON.stringify({ ownershipToken: "secret-attestation" });

    const result = await api.publishLiveDemoDatabaseArtifacts({
      repositoryRoot,
      current: databaseOwnedState(),
      databaseUrl,
      provisioningAttestationJson,
      statePublication: publication,
      artifactPublication: artifacts,
    });

    expect(result).toMatchObject({ outcome: "published", state: { status: "ready" } });
    expect(order).toEqual(["stage", "protect", "verify", "publish", "state-ready"]);
    expect(artifacts.stage).toHaveBeenCalledWith([
      expect.objectContaining({
        path: path.join(repositoryRoot, ".generated-tmp", "live-demo-database", "database-url.txt"),
      }),
      expect.objectContaining({
        path: path.join(
          repositoryRoot,
          ".generated-tmp",
          "live-demo-database",
          "provisioning-attestation.json",
        ),
      }),
      expect.objectContaining({
        path: path.join(repositoryRoot, ".generated-tmp", "live-demo-database", "activate.ps1"),
      }),
    ]);
    expect(artifacts.discard).not.toHaveBeenCalled();
  });

  it("retains a cleanup_required recovery record on permission or atomic publication failure", async () => {
    const api = await loadApi();
    const secret = "super-secret-password";
    const internalFailure = "access denied at C:\\private\\secret";
    const databaseUrl = `postgresql://demo:${secret}@127.0.0.1:54321/muster_live_demo_a1b2c3d4`;
    const repositoryRoot = path.resolve("fixture-repository");

    for (const [index, artifacts] of [
      artifactPublication({ verifyOwnerOnlyPermissions: vi.fn(async () => false) }),
      artifactPublication({
        publishAtomically: vi.fn(async () => {
          throw new Error(internalFailure);
        }),
      }),
    ].entries()) {
      const publication = statePublication();
      const result = await api.publishLiveDemoDatabaseArtifacts({
        repositoryRoot,
        current: databaseOwnedState(),
        databaseUrl,
        provisioningAttestationJson: JSON.stringify({ ownershipToken: secret }),
        statePublication: publication,
        artifactPublication: artifacts,
      });

      expect(result).toEqual({
        outcome: "cleanup_required",
        message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
      });
      expect(artifacts.discard).toHaveBeenCalledOnce();
      expect(publication.replaceAtomically).toHaveBeenCalledOnce();
      const nextSerializedState = vi.mocked(publication.replaceAtomically).mock.calls[0]?.[0]
        .nextSerializedState;
      expect(JSON.parse(nextSerializedState ?? "null")).toMatchObject({
        revision: 3,
        status: "cleanup_required",
        checkpoint: "database_owned",
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(internalFailure);
      if (index === 0) {
        expect(artifacts.publishAtomically).not.toHaveBeenCalled();
      }
    }

    const unavailableRecoveryState = statePublication({
      replaceAtomically: vi.fn(async () => false),
    });
    await expect(
      api.publishLiveDemoDatabaseArtifacts({
        repositoryRoot,
        current: databaseOwnedState(),
        databaseUrl,
        provisioningAttestationJson: JSON.stringify({ ownershipToken: secret }),
        statePublication: unavailableRecoveryState,
        artifactPublication: artifactPublication({
          verifyOwnerOnlyPermissions: vi.fn(async () => false),
        }),
      }),
    ).resolves.toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
  });
});

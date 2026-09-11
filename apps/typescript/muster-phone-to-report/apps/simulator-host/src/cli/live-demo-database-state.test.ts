import { describe, expect, it } from "vitest";

type Checkpoint =
  | "state_created"
  | "container_created"
  | "database_owned"
  | "artifacts_published"
  | "database_removed"
  | "container_removed";
type Status = "starting" | "ready" | "cleanup_required" | "disposing";

interface StateApi {
  readonly LIVE_DEMO_DATABASE_PINNED_IMAGE: string;
  parseLiveDemoDatabaseLifecycleState(value: unknown): unknown;
  serializeLiveDemoDatabaseLifecycleState(value: unknown): string;
  createInitialLiveDemoDatabaseLifecycleState(input: {
    readonly sessionId: string;
    readonly createdAt: string;
    readonly containerIntent?: unknown;
  }): unknown;
  transitionLiveDemoDatabaseLifecycleState(
    current: unknown,
    update: {
      readonly status: Status;
      readonly checkpoint: Checkpoint;
      readonly container?: unknown;
      readonly database?: unknown;
    },
  ): unknown;
}

async function loadApi(): Promise<StateApi> {
  return (await import("./live-demo-database-state.js")) as StateApi;
}

const sessionId = "018f7d34-3e12-7f3b-8c9d-123456789abc";
const createdAt = "2026-09-03T17:00:00.000Z";
const ownershipToken = "A".repeat(43);
const containerId = "a".repeat(64);
const digest = "b".repeat(64);

function containerProof(image: string): Record<string, unknown> {
  return {
    id: containerId,
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

function containerIntent(image: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(containerProof(image)).filter(([key]) => key !== "id"));
}

function databaseProof(): Record<string, unknown> {
  return {
    databaseName: "muster_live_demo_a1b2c3d4",
    databaseOwner: "muster_live_demo_owner_a1b2c3d4",
    provisioningOwnershipDigest: digest,
    attestationVersion: 1,
  };
}

function state(input: {
  readonly image: string;
  readonly revision?: number;
  readonly status?: Status;
  readonly checkpoint?: Checkpoint;
  readonly container?: Record<string, unknown> | null;
  readonly database?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    version: 1,
    revision: input.revision ?? 0,
    status: input.status ?? "starting",
    checkpoint: input.checkpoint ?? "state_created",
    session: { id: sessionId, createdAt },
    containerIntent: containerIntent(input.image),
    container: input.container ?? null,
    database: input.database ?? null,
  };
}

describe("disposable live-demo database lifecycle state", () => {
  it("persists immutable independent container ownership intent before container creation", async () => {
    const api = await loadApi();
    const proof = containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE);
    const intent = Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "id"));

    const initial = api.createInitialLiveDemoDatabaseLifecycleState({
      sessionId,
      createdAt,
      containerIntent: intent,
    });

    expect(initial).toMatchObject({ checkpoint: "state_created", containerIntent: intent });
    expect(() =>
      api.transitionLiveDemoDatabaseLifecycleState(initial, {
        status: "starting",
        checkpoint: "container_created",
        container: {
          ...proof,
          ownershipToken: "B".repeat(43),
          labels: {
            ...(proof["labels"] as Record<string, unknown>),
            "com.muster.live-demo-database.owner": "B".repeat(43),
          },
        },
      }),
    ).toThrow("Disposable live-demo database lifecycle transition is invalid");
  });

  it("accepts exact version-1 initial and ready recovery records", async () => {
    const api = await loadApi();
    const initial = state({ image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE });
    const ready = state({
      image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
      revision: 3,
      status: "ready",
      checkpoint: "artifacts_published",
      container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
      database: databaseProof(),
    });

    expect(api.parseLiveDemoDatabaseLifecycleState(initial)).toEqual(initial);
    expect(api.parseLiveDemoDatabaseLifecycleState(ready)).toEqual(ready);
    expect(JSON.parse(api.serializeLiveDemoDatabaseLifecycleState(ready))).toEqual(ready);
  });

  it("rejects unknown versions, extra properties, invalid revisions, and non-canonical timestamps", async () => {
    const api = await loadApi();
    const initial = state({ image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE });

    for (const candidate of [
      null,
      { ...initial, version: 2 },
      { ...initial, revision: -1 },
      { ...initial, unexpected: true },
      { ...initial, session: { id: sessionId, createdAt: "2026-09-03" } },
      { ...initial, session: { id: "latest", createdAt } },
    ]) {
      expect(() => api.parseLiveDemoDatabaseLifecycleState(candidate)).toThrow(
        "Disposable live-demo database lifecycle state is invalid",
      );
    }
  });

  it("rejects every changed independent container proof field", async () => {
    const api = await loadApi();
    const exact = containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE);
    const mutations: readonly Record<string, unknown>[] = [
      { ...exact, id: "short" },
      { ...exact, name: "muster-live-demo-database-latest" },
      { ...exact, image: "postgres:latest" },
      { ...exact, ownershipToken: "B".repeat(43) },
      {
        ...exact,
        labels: {
          ...(exact["labels"] as Record<string, unknown>),
          "com.muster.live-demo-database.session": "018f7d34-3e12-7f3b-8c9d-ffffffffffff",
        },
      },
      { ...exact, binding: { host: "0.0.0.0", hostPort: 54321, containerPort: 5432 } },
      { ...exact, binding: { host: "127.0.0.1", hostPort: 54321, containerPort: 5433 } },
      { ...exact, storage: "volume" },
      { ...exact, extraProof: true },
    ];

    for (const container of mutations) {
      const candidate = state({
        image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
        revision: 1,
        checkpoint: "container_created",
        container,
      });
      expect(() => api.parseLiveDemoDatabaseLifecycleState(candidate)).toThrow(
        "Disposable live-demo database lifecycle state is invalid",
      );
    }
  });

  it("rejects changed or insufficient database proof instead of reimplementing ownership inference", async () => {
    const api = await loadApi();
    const container = containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE);
    const exact = databaseProof();

    for (const database of [
      { ...exact, databaseName: "postgres" },
      { ...exact, databaseOwner: "root" },
      { ...exact, provisioningOwnershipDigest: "not-a-digest" },
      { ...exact, attestationVersion: 2 },
      { ...exact, ownershipComment: "name-based-proof-is-not-authority" },
    ]) {
      expect(() =>
        api.parseLiveDemoDatabaseLifecycleState(
          state({
            image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
            revision: 2,
            checkpoint: "database_owned",
            container,
            database,
          }),
        ),
      ).toThrow("Disposable live-demo database lifecycle state is invalid");
    }
  });

  it("requires proof fields to agree with the lifecycle checkpoint", async () => {
    const api = await loadApi();
    const container = containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE);
    const database = databaseProof();

    for (const candidate of [
      state({ image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE, container }),
      state({
        image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
        revision: 1,
        checkpoint: "container_created",
      }),
      state({
        image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
        revision: 2,
        checkpoint: "database_owned",
        container,
      }),
      state({
        image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
        revision: 3,
        status: "starting",
        checkpoint: "artifacts_published",
        container,
        database,
      }),
      state({
        image: api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
        revision: 3,
        status: "ready",
        checkpoint: "database_owned",
        container,
        database,
      }),
    ]) {
      expect(() => api.parseLiveDemoDatabaseLifecycleState(candidate)).toThrow(
        "Disposable live-demo database lifecycle state is invalid",
      );
    }
  });

  it("advances the creation checkpoints in order without allowing proof replacement", async () => {
    const api = await loadApi();
    const initial = api.createInitialLiveDemoDatabaseLifecycleState({
      sessionId,
      createdAt,
      containerIntent: containerIntent(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
    });
    const container = containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE);
    const database = databaseProof();

    const withContainer = api.transitionLiveDemoDatabaseLifecycleState(initial, {
      status: "starting",
      checkpoint: "container_created",
      container,
    });
    const withDatabase = api.transitionLiveDemoDatabaseLifecycleState(withContainer, {
      status: "starting",
      checkpoint: "database_owned",
      database,
    });
    const ready = api.transitionLiveDemoDatabaseLifecycleState(withDatabase, {
      status: "ready",
      checkpoint: "artifacts_published",
    });

    expect(ready).toMatchObject({ version: 1, revision: 3, status: "ready" });
    expect(() =>
      api.transitionLiveDemoDatabaseLifecycleState(withDatabase, {
        status: "ready",
        checkpoint: "artifacts_published",
        container: { ...container, id: "c".repeat(64) },
      }),
    ).toThrow("Disposable live-demo database lifecycle transition is invalid");
    expect(() =>
      api.transitionLiveDemoDatabaseLifecycleState(initial, {
        status: "ready",
        checkpoint: "artifacts_published",
        container,
        database,
      }),
    ).toThrow("Disposable live-demo database lifecycle transition is invalid");
  });

  it("introduces database proof only on the designated container_created to database_owned transition", async () => {
    const api = await loadApi();
    const initial = api.createInitialLiveDemoDatabaseLifecycleState({
      sessionId,
      createdAt,
      containerIntent: containerIntent(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
    });
    const withContainer = api.transitionLiveDemoDatabaseLifecycleState(initial, {
      status: "starting",
      checkpoint: "container_created",
      container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
    });
    expect(
      api.transitionLiveDemoDatabaseLifecycleState(withContainer, {
        status: "starting",
        checkpoint: "database_owned",
        database: databaseProof(),
      }),
    ).toMatchObject({ checkpoint: "database_owned", database: databaseProof() });

    const cleanupRequired = api.transitionLiveDemoDatabaseLifecycleState(withContainer, {
      status: "cleanup_required",
      checkpoint: "container_created",
    });
    const disposing = api.transitionLiveDemoDatabaseLifecycleState(cleanupRequired, {
      status: "disposing",
      checkpoint: "container_created",
    });
    const containerRemoved = api.transitionLiveDemoDatabaseLifecycleState(disposing, {
      status: "disposing",
      checkpoint: "container_removed",
    });

    for (const [current, update] of [
      [
        withContainer,
        {
          status: "cleanup_required" as const,
          checkpoint: "container_created" as const,
          database: databaseProof(),
        },
      ],
      [
        cleanupRequired,
        {
          status: "disposing" as const,
          checkpoint: "container_created" as const,
          database: databaseProof(),
        },
      ],
      [
        disposing,
        {
          status: "disposing" as const,
          checkpoint: "container_removed" as const,
          database: databaseProof(),
        },
      ],
      [
        containerRemoved,
        {
          status: "cleanup_required" as const,
          checkpoint: "container_removed" as const,
          database: databaseProof(),
        },
      ],
    ] as const) {
      expect(() => api.transitionLiveDemoDatabaseLifecycleState(current, update)).toThrow(
        "Disposable live-demo database lifecycle transition is invalid",
      );
    }
  });

  it("introduces recovered container proof only from disposing/state_created", async () => {
    const api = await loadApi();
    const initial = api.createInitialLiveDemoDatabaseLifecycleState({
      sessionId,
      createdAt,
      containerIntent: containerIntent(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
    });
    expect(
      api.transitionLiveDemoDatabaseLifecycleState(initial, {
        status: "starting",
        checkpoint: "container_created",
        container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
      }),
    ).toMatchObject({ checkpoint: "container_created" });

    const cleanupRequired = api.transitionLiveDemoDatabaseLifecycleState(initial, {
      status: "cleanup_required",
      checkpoint: "state_created",
    });
    const disposing = api.transitionLiveDemoDatabaseLifecycleState(cleanupRequired, {
      status: "disposing",
      checkpoint: "state_created",
    });
    expect(() =>
      api.transitionLiveDemoDatabaseLifecycleState(cleanupRequired, {
        status: "cleanup_required",
        checkpoint: "container_created",
        container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
      }),
    ).toThrow("Disposable live-demo database lifecycle transition is invalid");

    expect(
      api.transitionLiveDemoDatabaseLifecycleState(disposing, {
        status: "disposing",
        checkpoint: "container_created",
        container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
      }),
    ).toMatchObject({
      revision: 3,
      status: "disposing",
      checkpoint: "container_created",
      container: { id: containerId },
    });

    expect(() =>
      api.transitionLiveDemoDatabaseLifecycleState(disposing, {
        status: "cleanup_required",
        checkpoint: "container_created",
        container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
      }),
    ).toThrow("Disposable live-demo database lifecycle transition is invalid");
  });

  it("enters cleanup_required at the last proven checkpoint and resumes cleanup without skipping proof", async () => {
    const api = await loadApi();
    const initial = api.createInitialLiveDemoDatabaseLifecycleState({
      sessionId,
      createdAt,
      containerIntent: containerIntent(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
    });
    const withContainer = api.transitionLiveDemoDatabaseLifecycleState(initial, {
      status: "starting",
      checkpoint: "container_created",
      container: containerProof(api.LIVE_DEMO_DATABASE_PINNED_IMAGE),
    });
    const cleanupRequired = api.transitionLiveDemoDatabaseLifecycleState(withContainer, {
      status: "cleanup_required",
      checkpoint: "container_created",
    });
    const disposing = api.transitionLiveDemoDatabaseLifecycleState(cleanupRequired, {
      status: "disposing",
      checkpoint: "container_created",
    });
    const removed = api.transitionLiveDemoDatabaseLifecycleState(disposing, {
      status: "disposing",
      checkpoint: "container_removed",
    });

    expect(cleanupRequired).toMatchObject({
      revision: 2,
      status: "cleanup_required",
      checkpoint: "container_created",
    });
    expect(removed).toMatchObject({
      revision: 4,
      status: "disposing",
      checkpoint: "container_removed",
    });
    expect(() =>
      api.transitionLiveDemoDatabaseLifecycleState(cleanupRequired, {
        status: "disposing",
        checkpoint: "container_removed",
      }),
    ).toThrow("Disposable live-demo database lifecycle transition is invalid");
  });
});

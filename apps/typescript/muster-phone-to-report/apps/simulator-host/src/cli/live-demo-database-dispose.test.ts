import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { LiveDemoDatabaseStatePublication } from "./live-demo-database-lifecycle.js";
import {
  LIVE_DEMO_DATABASE_PINNED_IMAGE,
  createInitialLiveDemoDatabaseLifecycleState,
  serializeLiveDemoDatabaseLifecycleState,
  transitionLiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseLifecycleState,
} from "./live-demo-database-state.js";

interface ProcessRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly output: "capture_suppressed" | "ignore";
}

interface DisposeCapabilities {
  readonly process: {
    run(request: ProcessRequest): Promise<Readonly<{ exitCode: number; stdout: string }>>;
  };
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly state: LiveDemoDatabaseStatePublication & {
    loadOwnerOnly(maximumBytes: number): Promise<string | undefined>;
    removeExact(expectedSerializedState: string): Promise<boolean>;
  };
  readonly artifacts: {
    verifyOwnerOnly(path: string): Promise<boolean>;
    readOwnerOnly(path: string, maximumBytes: number): Promise<string | undefined>;
    removeWithin(path: string, timeoutMs: number): Promise<boolean>;
  };
  readonly ownership: {
    createDisposablePostgresOwner(
      connectionString: string,
      input: Readonly<{ loadProvisioningAttestation: () => Promise<unknown> }>,
    ): Readonly<{
      attestOwnership(): Promise<OwnershipAttestation>;
      teardown(input: {
        readonly closeConnections: () => Promise<void>;
        readonly expectedProvisioningOwnershipDigest: string;
      }): Promise<Readonly<{ outcome: "deleted" }>>;
      verifyDeleted(input: {
        readonly expectedProvisioningOwnershipDigest: string;
      }): Promise<boolean>;
    }>;
  };
  readonly closeConnections: () => Promise<void>;
}

type OwnershipAttestation =
  | Readonly<{
      outcome: "owned";
      exclusive: true;
      provisioningOwnershipDigest: string;
    }>
  | Readonly<{ outcome: "mismatch" | "missing" | "indeterminate" }>;

interface DisposeApi {
  readonly LIVE_DEMO_DATABASE_ATTENTION_MESSAGE: string;
  readonly LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE: string;
  disposeLiveDemoDatabase(input: {
    readonly repositoryRoot: string;
    readonly capabilities: DisposeCapabilities;
  }): Promise<Record<string, unknown>>;
}

async function loadApi(): Promise<DisposeApi> {
  return (await import("./live-demo-database-dispose.js")) as DisposeApi;
}

const repositoryRoot = path.resolve("fixture-repository");
const sessionId = "018f7d34-3e12-7f3b-8c9d-123456789abc";
const containerId = "a".repeat(64);
const containerToken = "C".repeat(43);
const databaseToken = "D".repeat(43);
const databaseName = "muster_live_demo_a1b2c3d4";
const databaseOwner = "muster_live_demo_owner_a1b2c3d4";
const digest = "b".repeat(64);
const hostPort = 54_321;
const root = path.join(repositoryRoot, ".generated-tmp", "live-demo-database");
const paths = Object.freeze({
  lifecycle: path.join(root, "lifecycle-state.json"),
  databaseUrl: path.join(root, "database-url.txt"),
  attestation: path.join(root, "provisioning-attestation.json"),
  activation: path.join(root, "activate.ps1"),
  cid: path.join(root, "container.cid"),
  labels: path.join(root, "container-labels.tmp"),
  recovery: path.join(root, "recovery-material.json"),
});
const databaseUrl = `postgresql://${databaseOwner}:never-print-this-password@127.0.0.1:${hostPort}/${databaseName}`;
const attestation = Object.freeze({
  version: 1 as const,
  databaseName,
  databaseOid: "16384",
  clusterSystemIdentifier: "7441111111111111111",
  ownershipToken: databaseToken,
  exclusive: true as const,
});

function initialState(): LiveDemoDatabaseLifecycleState {
  return createInitialLiveDemoDatabaseLifecycleState({
    sessionId,
    createdAt: "2026-09-03T17:00:00.000Z",
    containerIntent: {
      name: `muster-live-demo-database-${sessionId}`,
      image: LIVE_DEMO_DATABASE_PINNED_IMAGE,
      ownershipToken: containerToken,
      labels: {
        "com.muster.live-demo-database.session": sessionId,
        "com.muster.live-demo-database.owner": containerToken,
      },
      binding: { host: "127.0.0.1", hostPort, containerPort: 5432 },
      storage: "tmpfs",
    },
  });
}

function readyState(): LiveDemoDatabaseLifecycleState {
  const withContainer = transitionLiveDemoDatabaseLifecycleState(initialState(), {
    status: "starting",
    checkpoint: "container_created",
    container: {
      id: containerId,
      ...initialState().containerIntent,
    },
  });
  const withDatabase = transitionLiveDemoDatabaseLifecycleState(withContainer, {
    status: "starting",
    checkpoint: "database_owned",
    database: {
      databaseName,
      databaseOwner,
      provisioningOwnershipDigest: digest,
      attestationVersion: 1,
    },
  });
  return transitionLiveDemoDatabaseLifecycleState(withDatabase, {
    status: "ready",
    checkpoint: "artifacts_published",
  });
}

function cleanupRequiredDatabaseOwnedState(): LiveDemoDatabaseLifecycleState {
  const withContainer = transitionLiveDemoDatabaseLifecycleState(initialState(), {
    status: "starting",
    checkpoint: "container_created",
    container: { id: containerId, ...initialState().containerIntent },
  });
  const withDatabase = transitionLiveDemoDatabaseLifecycleState(withContainer, {
    status: "starting",
    checkpoint: "database_owned",
    database: {
      databaseName,
      databaseOwner,
      provisioningOwnershipDigest: digest,
      attestationVersion: 1,
    },
  });
  return transitionLiveDemoDatabaseLifecycleState(withDatabase, {
    status: "cleanup_required",
    checkpoint: "database_owned",
  });
}

function containerCreatedState(): LiveDemoDatabaseLifecycleState {
  return transitionLiveDemoDatabaseLifecycleState(initialState(), {
    status: "starting",
    checkpoint: "container_created",
    container: { id: containerId, ...initialState().containerIntent },
  });
}

function cleanupRequiredStateCreated(): LiveDemoDatabaseLifecycleState {
  return transitionLiveDemoDatabaseLifecycleState(initialState(), {
    status: "cleanup_required",
    checkpoint: "state_created",
  });
}

function disposingStateCreated(): LiveDemoDatabaseLifecycleState {
  return transitionLiveDemoDatabaseLifecycleState(cleanupRequiredStateCreated(), {
    status: "disposing",
    checkpoint: "state_created",
  });
}

function disposingAt(
  checkpoint: "artifacts_published" | "database_removed" | "container_removed",
): LiveDemoDatabaseLifecycleState {
  let state = transitionLiveDemoDatabaseLifecycleState(readyState(), {
    status: "disposing",
    checkpoint: "artifacts_published",
  });
  if (checkpoint === "artifacts_published") return state;
  state = transitionLiveDemoDatabaseLifecycleState(state, {
    status: "disposing",
    checkpoint: "database_removed",
  });
  if (checkpoint === "database_removed") return state;
  return transitionLiveDemoDatabaseLifecycleState(state, {
    status: "disposing",
    checkpoint: "container_removed",
  });
}

function disposingContainerOnlyState(): LiveDemoDatabaseLifecycleState {
  const withContainer = containerCreatedState();
  const cleanupRequired = transitionLiveDemoDatabaseLifecycleState(withContainer, {
    status: "cleanup_required",
    checkpoint: "container_created",
  });
  return transitionLiveDemoDatabaseLifecycleState(cleanupRequired, {
    status: "disposing",
    checkpoint: "container_created",
  });
}

function inspectOutput(
  overrides: Readonly<{
    image?: string;
    ownerLabel?: string;
    host?: string;
    tmpfs?: string;
    extraLabel?: boolean;
  }> = {},
): string {
  return JSON.stringify({
    Id: containerId,
    Name: `/muster-live-demo-database-${sessionId}`,
    Config: {
      Image: overrides.image ?? LIVE_DEMO_DATABASE_PINNED_IMAGE,
      Labels: {
        "com.muster.live-demo-database.session": sessionId,
        "com.muster.live-demo-database.owner": overrides.ownerLabel ?? containerToken,
        ...(overrides.extraLabel === true ? { "com.muster.unexpected": "value" } : {}),
      },
    },
    HostConfig: {
      Binds: null,
      PortBindings: {
        "5432/tcp": [{ HostIp: overrides.host ?? "127.0.0.1", HostPort: String(hostPort) }],
      },
      Tmpfs: {
        "/var/lib/postgresql/data": overrides.tmpfs ?? "rw,noexec,nosuid,nodev,size=536870912",
      },
    },
    Mounts: [],
    State: { Status: "running", Health: { Status: "healthy" } },
  });
}

function createHarness(
  input: Readonly<{
    initial?: LiveDemoDatabaseLifecycleState;
    inspect?: string;
    inspectExitCode?: number;
    psResponses?: readonly (Readonly<{ exitCode: number; stdout: string }> | Error)[];
    removalVerification?: string;
    attest?: OwnershipAttestation;
    verifyDeleted?: boolean;
    teardownRejects?: boolean;
    replaceFailsAtCheckpoint?: string;
    removalFails?: boolean;
    artifactRemovalFailsAt?: string;
    tamperedDatabaseUrl?: string;
    tamperedAttestation?: unknown;
    missingPublishedArtifacts?: boolean;
    protectedRecoveryMaterial?: boolean;
    preCreateOnly?: boolean;
    unexpectedArtifacts?: readonly Readonly<{ path: string; contents: string }>[];
    waitRejects?: boolean;
    removeExactFails?: boolean;
  }> = {},
): Readonly<{
  capabilities: DisposeCapabilities;
  events: string[];
  processRun: ReturnType<typeof vi.fn<DisposeCapabilities["process"]["run"]>>;
  teardown: ReturnType<typeof vi.fn>;
  attestOwnership: ReturnType<typeof vi.fn>;
  verifyDeleted: ReturnType<typeof vi.fn>;
  removeExact: ReturnType<typeof vi.fn>;
  removeWithin: ReturnType<typeof vi.fn>;
  wait: ReturnType<typeof vi.fn>;
  currentSerializedState: () => string | undefined;
}> {
  const events: string[] = [];
  let serializedState: string | undefined = serializeLiveDemoDatabaseLifecycleState(
    input.initial ?? readyState(),
  );
  const files = new Map<string, string>([[paths.lifecycle, serializedState]]);
  if (input.preCreateOnly === true) {
    files.set(paths.cid, "");
    files.set(paths.labels, "protected labels\n");
  } else {
    files.set(paths.databaseUrl, `${input.tamperedDatabaseUrl ?? databaseUrl}\n`);
    files.set(paths.attestation, `${JSON.stringify(input.tamperedAttestation ?? attestation)}\n`);
    files.set(paths.activation, "# protected activation\n");
  }
  for (const artifact of input.unexpectedArtifacts ?? []) {
    files.set(artifact.path, artifact.contents);
  }
  let inspectCalls = 0;
  let psCalls = 0;
  const processRun = vi.fn<DisposeCapabilities["process"]["run"]>(async (request) => {
    const action = request.arguments[0] ?? "unknown";
    events.push(`process:${action}`);
    if (action === "inspect") {
      inspectCalls += 1;
      return {
        exitCode: input.inspectExitCode ?? 0,
        stdout: input.inspect ?? inspectOutput(),
      };
    }
    if (action === "rm") {
      return { exitCode: input.removalFails === true ? 1 : 0, stdout: "" };
    }
    if (action === "ps") {
      const response = input.psResponses?.[psCalls];
      psCalls += 1;
      if (response instanceof Error) throw response;
      return response ?? { exitCode: 0, stdout: input.removalVerification ?? "" };
    }
    return { exitCode: 1, stdout: "" };
  });
  const attestOwnership = vi.fn(async (): Promise<OwnershipAttestation> => {
    events.push("database:attest");
    return (
      input.attest ?? {
        outcome: "owned",
        exclusive: true,
        provisioningOwnershipDigest: digest,
      }
    );
  });
  const teardown = vi.fn(
    async ({ closeConnections }: { closeConnections: () => Promise<void> }) => {
      events.push("database:teardown");
      await closeConnections();
      if (input.teardownRejects === true) throw new Error("ambiguous teardown");
      return { outcome: "deleted" as const };
    },
  );
  const verifyDeleted = vi.fn(async () => {
    events.push("database:verify-deleted");
    return input.verifyDeleted ?? true;
  });
  const replaceAtomically = vi.fn<LiveDemoDatabaseStatePublication["replaceAtomically"]>(
    async ({ expectedSerializedState, nextSerializedState }) => {
      const next = JSON.parse(nextSerializedState) as { checkpoint: string };
      events.push(`state:${next.checkpoint}`);
      if (
        serializedState !== expectedSerializedState ||
        input.replaceFailsAtCheckpoint === next.checkpoint
      ) {
        return false;
      }
      serializedState = nextSerializedState;
      files.set(paths.lifecycle, nextSerializedState);
      return true;
    },
  );
  const removeExact = vi.fn(async (expected: string) => {
    events.push("state:remove");
    if (
      input.removeExactFails === true ||
      serializedState !== expected ||
      [...files.keys()].some((filePath) => filePath !== paths.lifecycle)
    ) {
      return false;
    }
    serializedState = undefined;
    files.delete(paths.lifecycle);
    return true;
  });
  if (input.missingPublishedArtifacts === true) {
    files.delete(paths.databaseUrl);
    files.delete(paths.attestation);
    files.delete(paths.activation);
  }
  if (input.protectedRecoveryMaterial === true) {
    files.set(
      paths.recovery,
      `${JSON.stringify({ version: 1, databaseUrl, provisioningAttestation: attestation })}\n`,
    );
  }
  const removeWithin = vi.fn(async (filePath: string) => {
    events.push(`artifact:remove:${path.basename(filePath)}`);
    if (input.artifactRemovalFailsAt === filePath) return false;
    files.delete(filePath);
    return true;
  });
  const wait = vi.fn(async (milliseconds: number) => {
    events.push(`wait:${milliseconds}`);
    if (input.waitRejects === true) throw new Error("quiescence unavailable");
  });
  const capabilities: DisposeCapabilities = {
    process: { run: processRun },
    wait,
    state: {
      createExclusive: vi.fn(async () => false),
      replaceAtomically,
      loadOwnerOnly: vi.fn(async () => serializedState),
      removeExact,
    },
    artifacts: {
      verifyOwnerOnly: vi.fn(async (filePath) => files.has(filePath)),
      readOwnerOnly: vi.fn(async (filePath) => files.get(filePath)),
      removeWithin,
    },
    ownership: {
      createDisposablePostgresOwner: vi.fn((_connectionString, ownerInput) => ({
        attestOwnership: async () => {
          await ownerInput.loadProvisioningAttestation();
          return await attestOwnership();
        },
        teardown,
        verifyDeleted,
      })),
    },
    closeConnections: vi.fn(async () => {
      events.push("database:close-connections");
    }),
  };
  return Object.freeze({
    capabilities,
    events,
    processRun,
    teardown,
    attestOwnership,
    verifyDeleted,
    removeExact,
    removeWithin,
    wait,
    currentSerializedState: () => serializedState,
    inspectCalls,
  });
}

describe("disposable live-demo database disposal", () => {
  it("blocks starting/state_created before Docker queries, lifecycle writes, or artifact removal", async () => {
    const api = await loadApi();
    const harness = createHarness({ initial: initialState(), preCreateOnly: true });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toEqual({ outcome: "blocked", message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE });
    expect(harness.processRun).not.toHaveBeenCalled();
    expect(harness.capabilities.state.replaceAtomically).not.toHaveBeenCalled();
    expect(harness.removeWithin).not.toHaveBeenCalled();

    const lostCas = createHarness({
      initial: cleanupRequiredStateCreated(),
      preCreateOnly: true,
      replaceFailsAtCheckpoint: "state_created",
    });
    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: lostCas.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(lostCas.processRun).not.toHaveBeenCalled();
    expect(lostCas.removeWithin).not.toHaveBeenCalled();
    expect(lostCas.currentSerializedState()).toContain('"status":"cleanup_required"');
  });

  it.each([
    ["cleanup_required", cleanupRequiredStateCreated()],
    ["resumed disposing", disposingStateCreated()],
  ] as const)(
    "reconciles stable Docker absence from %s/state_created and removes only pre-create transients",
    async (_status, initial) => {
      const api = await loadApi();
      const harness = createHarness({ initial, preCreateOnly: true });

      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
      ).resolves.toEqual({
        outcome: "disposed",
        message: api.LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
      });

      const psRequests = harness.processRun.mock.calls
        .map(([request]) => request)
        .filter((request) => request.arguments[0] === "ps");
      expect(psRequests).toHaveLength(6);
      for (let index = 0; index < psRequests.length; index += 2) {
        expect(psRequests[index]?.arguments).toEqual([
          "ps",
          "--all",
          "--no-trunc",
          "--filter",
          `name=^/muster-live-demo-database-${sessionId}$`,
          "--format",
          "{{.ID}}",
        ]);
        expect(psRequests[index + 1]?.arguments).toEqual([
          "ps",
          "--all",
          "--no-trunc",
          "--filter",
          `label=com.muster.live-demo-database.session=${sessionId}`,
          "--format",
          "{{.ID}}",
        ]);
      }
      expect(harness.wait).toHaveBeenCalledOnce();
      expect(harness.wait).toHaveBeenCalledWith(10_000);
      expect(harness.removeWithin.mock.calls.map(([filePath]) => filePath)).toEqual([
        paths.cid,
        paths.labels,
      ]);
      expect(harness.removeExact).toHaveBeenCalledOnce();
      expect(harness.teardown).not.toHaveBeenCalled();
      expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
        false,
      );
      expect(JSON.stringify(harness.processRun.mock.calls)).not.toContain(containerToken);
    },
  );

  it("adopts a stable exact singleton as durable proof before normal exact removal", async () => {
    const api = await loadApi();
    const singleton = { exitCode: 0, stdout: `${containerId}\n` } as const;
    const harness = createHarness({
      initial: cleanupRequiredStateCreated(),
      preCreateOnly: true,
      psResponses: [singleton, singleton, singleton, singleton, { exitCode: 0, stdout: "" }],
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });

    const adoptionIndex = harness.events.indexOf("state:container_created");
    const removalIndex = harness.events.indexOf("process:rm");
    expect(adoptionIndex).toBeGreaterThan(harness.events.indexOf("process:inspect"));
    expect(removalIndex).toBeGreaterThan(adoptionIndex);
    expect(
      harness.events.filter((event) => event === "process:inspect").length,
    ).toBeGreaterThanOrEqual(2);
    expect(harness.events).toContain("state:container_removed");
    expect(harness.removeWithin.mock.calls.map(([filePath]) => filePath)).toEqual([
      paths.cid,
      paths.labels,
    ]);
    expect(JSON.stringify(harness.processRun.mock.calls)).not.toContain(containerToken);
  });

  it.each([
    ["selector failure", [{ exitCode: 1, stdout: "" }]],
    ["selector throw", [new Error("suppressed Docker failure")]],
    ["malformed ID", [{ exitCode: 0, stdout: "short\n" }]],
    ["multiple IDs", [{ exitCode: 0, stdout: `${containerId}\n${"b".repeat(64)}\n` }]],
  ] as const)("retains disposing/state_created on %s", async (_case, psResponses) => {
    const api = await loadApi();
    const harness = createHarness({
      initial: cleanupRequiredStateCreated(),
      preCreateOnly: true,
      psResponses,
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.currentSerializedState()).toContain('"status":"disposing"');
    expect(harness.currentSerializedState()).toContain('"checkpoint":"state_created"');
    expect(harness.wait).not.toHaveBeenCalled();
    expect(harness.removeWithin).not.toHaveBeenCalled();
    expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
      false,
    );
  });

  it("blocks when exact name and session selectors disagree", async () => {
    const api = await loadApi();
    const harness = createHarness({
      initial: cleanupRequiredStateCreated(),
      preCreateOnly: true,
      psResponses: [
        { exitCode: 0, stdout: `${containerId}\n` },
        { exitCode: 0, stdout: "" },
      ],
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.wait).not.toHaveBeenCalled();
    expect(harness.removeWithin).not.toHaveBeenCalled();
    expect(harness.currentSerializedState()).toContain('"status":"disposing"');
  });

  it("blocks when the complete selector snapshot changes across quiescence", async () => {
    const api = await loadApi();
    const singleton = { exitCode: 0, stdout: `${containerId}\n` } as const;
    const empty = { exitCode: 0, stdout: "" } as const;
    const harness = createHarness({
      initial: disposingStateCreated(),
      preCreateOnly: true,
      psResponses: [singleton, singleton, empty, empty],
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.wait).toHaveBeenCalledWith(10_000);
    expect(harness.removeWithin).not.toHaveBeenCalled();
    expect(harness.currentSerializedState()).toContain('"checkpoint":"state_created"');
  });

  it("retains proofless state when a singleton inspection mismatches or proof adoption loses CAS", async () => {
    const api = await loadApi();
    const singleton = { exitCode: 0, stdout: `${containerId}\n` } as const;
    for (const options of [
      { inspect: inspectOutput({ ownerLabel: "X".repeat(43) }) },
      { replaceFailsAtCheckpoint: "container_created" },
    ] as const) {
      const harness = createHarness({
        initial: disposingStateCreated(),
        preCreateOnly: true,
        psResponses: [singleton, singleton, singleton, singleton],
        ...options,
      });

      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
      ).resolves.toMatchObject({ outcome: "blocked" });
      expect(harness.currentSerializedState()).toContain('"checkpoint":"state_created"');
      expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
        false,
      );
      expect(harness.removeWithin).not.toHaveBeenCalled();
    }
  });

  it("retains lifecycle state when a candidate appears in the final absence snapshot", async () => {
    const api = await loadApi();
    const empty = { exitCode: 0, stdout: "" } as const;
    const singleton = { exitCode: 0, stdout: `${containerId}\n` } as const;
    const harness = createHarness({
      initial: disposingStateCreated(),
      preCreateOnly: true,
      psResponses: [empty, empty, empty, empty, singleton, singleton],
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.removeWithin.mock.calls.map(([filePath]) => filePath)).toEqual([
      paths.cid,
      paths.labels,
    ]);
    expect(harness.removeExact).not.toHaveBeenCalled();
    expect(harness.currentSerializedState()).toContain('"checkpoint":"state_created"');
  });

  it("fails closed on quiescence, fixed-transient, lifecycle-delete, and unexpected-artifact races", async () => {
    const api = await loadApi();
    const cases = [
      createHarness({
        initial: disposingStateCreated(),
        preCreateOnly: true,
        waitRejects: true,
      }),
      createHarness({
        initial: disposingStateCreated(),
        preCreateOnly: true,
        artifactRemovalFailsAt: paths.cid,
      }),
      createHarness({
        initial: disposingStateCreated(),
        preCreateOnly: true,
        removeExactFails: true,
      }),
      createHarness({
        initial: disposingStateCreated(),
        preCreateOnly: true,
        unexpectedArtifacts: [{ path: paths.databaseUrl, contents: "unexpected\n" }],
      }),
    ];

    for (const harness of cases) {
      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
      ).resolves.toMatchObject({ outcome: "blocked" });
      expect(harness.currentSerializedState()).toContain('"checkpoint":"state_created"');
      expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
        false,
      );
      expect(harness.removeWithin).not.toHaveBeenCalledWith(paths.databaseUrl, 2_000);
    }
  });

  it("drops the exact owned database, checkpoints each effect, removes the exact container, and deletes artifacts last", async () => {
    const api = await loadApi();
    const harness = createHarness();

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toEqual({
      outcome: "disposed",
      message: api.LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
    });
    expect(harness.events).toEqual([
      "process:inspect",
      "state:artifacts_published",
      "database:attest",
      "database:teardown",
      "database:close-connections",
      "database:verify-deleted",
      "state:database_removed",
      "process:inspect",
      "process:rm",
      "process:ps",
      "state:container_removed",
      "artifact:remove:database-url.txt",
      "artifact:remove:provisioning-attestation.json",
      "artifact:remove:activate.ps1",
      "artifact:remove:container.cid",
      "artifact:remove:container-labels.tmp",
      "artifact:remove:recovery-material.json",
      "state:remove",
    ]);
  });

  it("accepts verified prior database deletion without repeating DROP", async () => {
    const api = await loadApi();
    const harness = createHarness({ attest: { outcome: "missing" }, verifyDeleted: true });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.teardown).not.toHaveBeenCalled();
    expect(harness.verifyDeleted).toHaveBeenCalledWith({
      expectedProvisioningOwnershipDigest: digest,
    });
  });

  it("resumes from database_removed without re-running database teardown", async () => {
    const api = await loadApi();
    const harness = createHarness({ initial: disposingAt("database_removed") });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.attestOwnership).not.toHaveBeenCalled();
    expect(harness.teardown).not.toHaveBeenCalled();
    expect(harness.verifyDeleted).toHaveBeenCalledTimes(1);
  });

  it("resumes from container_removed by performing only artifact-last cleanup", async () => {
    const api = await loadApi();
    const harness = createHarness({ initial: disposingAt("container_removed") });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.processRun).not.toHaveBeenCalled();
    expect(harness.attestOwnership).not.toHaveBeenCalled();
    expect(harness.removeExact).toHaveBeenCalledTimes(1);
  });

  it("recovers database_owned cleanup from protected recovery material when finalized activation artifacts are absent", async () => {
    const api = await loadApi();
    const harness = createHarness({
      initial: cleanupRequiredDatabaseOwnedState(),
      missingPublishedArtifacts: true,
      protectedRecoveryMaterial: true,
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.teardown).toHaveBeenCalledTimes(1);
    expect(harness.removeWithin).toHaveBeenCalledWith(paths.recovery, 2_000);
  });

  it("blocks container-only disposal when post-ownership recovery material outlives its state transition", async () => {
    const api = await loadApi();
    const harness = createHarness({
      initial: containerCreatedState(),
      missingPublishedArtifacts: true,
      protectedRecoveryMaterial: true,
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(harness.processRun).not.toHaveBeenCalled();
    expect(harness.teardown).not.toHaveBeenCalled();
    expect(harness.removeWithin).not.toHaveBeenCalled();
  });

  it("uses retained recovery material after a pre-publication database_removed checkpoint", async () => {
    const api = await loadApi();
    const harness = createHarness({
      initial: disposingAt("database_removed"),
      missingPublishedArtifacts: true,
      protectedRecoveryMaterial: true,
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.verifyDeleted).toHaveBeenCalledTimes(1);
    expect(harness.removeWithin).toHaveBeenCalledWith(paths.recovery, 2_000);
  });

  it("never substitutes recovery material for missing finalized artifacts on a published session", async () => {
    const api = await loadApi();
    const harness = createHarness({
      missingPublishedArtifacts: true,
      protectedRecoveryMaterial: true,
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.teardown).not.toHaveBeenCalled();
    expect(harness.processRun).not.toHaveBeenCalled();
  });

  it("checkpoints container removal after the exact database_removed crash window without reconnecting", async () => {
    const api = await loadApi();
    const harness = createHarness({
      initial: disposingAt("database_removed"),
      inspectExitCode: 1,
      removalVerification: "",
      verifyDeleted: false,
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.verifyDeleted).not.toHaveBeenCalled();
    expect(harness.removeExact).toHaveBeenCalledTimes(1);
  });

  it("checkpoints a verified prior container removal after interrupted container-only cleanup", async () => {
    const api = await loadApi();
    const harness = createHarness({
      initial: disposingContainerOnlyState(),
      preCreateOnly: true,
      inspectExitCode: 1,
      removalVerification: "",
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "disposed" });
    expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
      false,
    );
    expect(harness.removeExact).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["image", { image: "postgres:latest" }],
    ["ownership label", { ownerLabel: "X".repeat(43) }],
    ["loopback binding", { host: "0.0.0.0" }],
    ["temporary mount", { tmpfs: "rw,size=536870912" }],
    ["unexpected label", { extraLabel: true }],
  ] as const)("refuses changed container %s without destructive work", async (_name, change) => {
    const api = await loadApi();
    const harness = createHarness({ inspect: inspectOutput(change) });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toEqual({ outcome: "blocked", message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE });
    expect(harness.teardown).not.toHaveBeenCalled();
    expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
      false,
    );
    expect(harness.removeExact).not.toHaveBeenCalled();
    expect(harness.currentSerializedState()).toBeDefined();
  });

  it.each([
    ["mismatched", { outcome: "mismatch" }],
    ["indeterminate", { outcome: "indeterminate" }],
    [
      "wrong digest",
      { outcome: "owned", exclusive: true, provisioningOwnershipDigest: "c".repeat(64) },
    ],
  ] as const)(
    "refuses %s database ownership without DROP or container removal",
    async (_name, ownership) => {
      const api = await loadApi();
      const harness = createHarness({ attest: ownership as OwnershipAttestation });

      await expect(
        api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
      ).resolves.toMatchObject({ outcome: "blocked" });
      expect(harness.teardown).not.toHaveBeenCalled();
      expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
        false,
      );
    },
  );

  it("refuses a tampered database URL before constructing destructive ownership", async () => {
    const api = await loadApi();
    const harness = createHarness({
      tamperedDatabaseUrl: databaseUrl.replace("127.0.0.1", "localhost"),
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.attestOwnership).not.toHaveBeenCalled();
    expect(harness.teardown).not.toHaveBeenCalled();
  });

  it("retains recovery state when prior deletion cannot be proven", async () => {
    const api = await loadApi();
    const harness = createHarness({ attest: { outcome: "missing" }, verifyDeleted: false });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.processRun.mock.calls.some(([request]) => request.arguments[0] === "rm")).toBe(
      false,
    );
    expect(harness.currentSerializedState()).toBeDefined();
  });

  it("does not start destructive work when the disposing checkpoint cannot be persisted", async () => {
    const api = await loadApi();
    const harness = createHarness({ replaceFailsAtCheckpoint: "artifacts_published" });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.attestOwnership).not.toHaveBeenCalled();
    expect(harness.teardown).not.toHaveBeenCalled();
  });

  it("re-attests the exact container immediately before removal and retains state on a second-inspection mismatch", async () => {
    const api = await loadApi();
    let inspections = 0;
    const harness = createHarness();
    harness.capabilities.process.run = vi.fn(async (request) => {
      if (request.arguments[0] === "inspect") {
        inspections += 1;
        return {
          exitCode: 0,
          stdout:
            inspections === 1 ? inspectOutput() : inspectOutput({ ownerLabel: "X".repeat(43) }),
        };
      }
      return { exitCode: 0, stdout: "" };
    });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.teardown).toHaveBeenCalledTimes(1);
    expect(harness.currentSerializedState()).toContain('"checkpoint":"database_removed"');
  });

  it("retains the database_removed checkpoint when exact container removal cannot be verified", async () => {
    const api = await loadApi();
    const harness = createHarness({ removalVerification: `${containerId}\n` });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.currentSerializedState()).toContain('"checkpoint":"database_removed"');
    expect(harness.removeWithin).not.toHaveBeenCalled();
  });

  it("keeps lifecycle state when artifact cleanup is incomplete so retry can finish", async () => {
    const api = await loadApi();
    const harness = createHarness({ artifactRemovalFailsAt: paths.activation });

    await expect(
      api.disposeLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities }),
    ).resolves.toMatchObject({ outcome: "blocked" });
    expect(harness.currentSerializedState()).toContain('"checkpoint":"container_removed"');
    expect(harness.removeExact).not.toHaveBeenCalled();
  });
});

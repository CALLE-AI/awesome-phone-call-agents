import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  LiveDemoDatabaseArtifactPublication,
  LiveDemoDatabaseStatePublication,
} from "./live-demo-database-lifecycle.js";

interface ProcessRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly standardInput?: string;
  readonly timeoutMs: number;
  readonly output: "capture_suppressed" | "ignore";
}

interface StartApi {
  readonly LIVE_DEMO_DATABASE_PINNED_IMAGE: string;
  readonly LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE: string;
  readonly LIVE_DEMO_DATABASE_ATTENTION_MESSAGE: string;
  startLiveDemoDatabase(input: {
    readonly repositoryRoot: string;
    readonly capabilities: StartCapabilities;
  }): Promise<Record<string, unknown>>;
}

interface StartCapabilities {
  readonly identity: {
    createSessionId(): string;
    nowIso(): string;
    createDatabaseSuffix(): string;
    createPassword(): string;
    createOwnershipToken(purpose: "container" | "database"): string;
    createHostPort(): number;
  };
  readonly process: {
    run(request: ProcessRequest): Promise<Readonly<{ exitCode: number; stdout: string }>>;
  };
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly protectedFiles: {
    createOwnerOnlyExclusive(input: {
      readonly path: string;
      readonly contents: string;
    }): Promise<boolean>;
    protectExisting(path: string): Promise<boolean>;
    verifyOwnerOnly(path: string): Promise<boolean>;
    readOwnerOnly(path: string, maximumBytes: number): Promise<string | undefined>;
    removeWithin(path: string, timeoutMs: number): Promise<boolean>;
  };
  readonly statePublication: LiveDemoDatabaseStatePublication;
  readonly artifactPublication: LiveDemoDatabaseArtifactPublication<object>;
  readonly ownership: {
    provisionExclusiveDisposablePostgresDatabaseOwnership(input: {
      readonly connectionString: string;
      readonly ownershipToken: string;
    }): Promise<ProvisioningAttestation>;
    createDisposablePostgresOwner(
      connectionString: string,
      input: Readonly<{ loadProvisioningAttestation: () => Promise<unknown> }>,
    ): Readonly<{
      attestOwnership(): Promise<
        | Readonly<{
            outcome: "owned";
            exclusive: true;
            provisioningOwnershipDigest: string;
          }>
        | Readonly<{ outcome: "mismatch" | "missing" | "indeterminate" }>
      >;
    }>;
  };
}

interface ProvisioningAttestation {
  readonly version: 1;
  readonly databaseName: string;
  readonly databaseOid: string;
  readonly clusterSystemIdentifier: string;
  readonly ownershipToken: string;
  readonly exclusive: true;
}

async function loadApi(): Promise<StartApi> {
  return (await import("./live-demo-database-start.js")) as StartApi;
}

const repositoryRoot = path.resolve("fixture-repository");
const sessionId = "018f7d34-3e12-7f3b-8c9d-123456789abc";
const createdAt = "2026-09-03T17:00:00.000Z";
const suffix = "a1b2c3d4";
const databaseName = `muster_live_demo_${suffix}`;
const databaseOwner = `muster_live_demo_owner_${suffix}`;
const password = "never-print-this-password";
const containerOwnershipToken = "C".repeat(43);
const databaseOwnershipToken = "D".repeat(43);
const containerId = "a".repeat(64);
const digest = "b".repeat(64);
const hostPort = 54_321;
const containerName = `muster-live-demo-database-${sessionId}`;
const protectedRoot = path.join(repositoryRoot, ".generated-tmp", "live-demo-database");
const labelFilePath = path.join(protectedRoot, "container-labels.tmp");
const cidFilePath = path.join(protectedRoot, "container.cid");
const recoveryMaterialPath = path.join(protectedRoot, "recovery-material.json");
const pinnedImage =
  "postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";

function inspectOutput(status: "created" | "starting" | "healthy" = "healthy"): string {
  return JSON.stringify({
    Id: containerId,
    Name: `/${containerName}`,
    Config: {
      Image: pinnedImage,
      Labels: {
        "com.muster.live-demo-database.session": sessionId,
        "com.muster.live-demo-database.owner": containerOwnershipToken,
      },
    },
    HostConfig: {
      PortBindings: {
        "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: String(hostPort) }],
      },
      Tmpfs: {
        "/var/lib/postgresql/data": "rw,noexec,nosuid,nodev,size=536870912",
      },
    },
    State: { Status: status === "created" ? "created" : "running", Health: { Status: status } },
  });
}

function createHarness(
  overrides: {
    readonly run?: StartCapabilities["process"]["run"];
    readonly replaceAtomically?: LiveDemoDatabaseStatePublication["replaceAtomically"];
    readonly provision?: StartCapabilities["ownership"]["provisionExclusiveDisposablePostgresDatabaseOwnership"];
    readonly attest?: ReturnType<
      StartCapabilities["ownership"]["createDisposablePostgresOwner"]
    >["attestOwnership"];
    readonly verifyPermissions?: LiveDemoDatabaseArtifactPublication<object>["verifyOwnerOnlyPermissions"];
    readonly createProtectedFile?: StartCapabilities["protectedFiles"]["createOwnerOnlyExclusive"];
    readonly protectExisting?: StartCapabilities["protectedFiles"]["protectExisting"];
    readonly verifyProtectedFile?: StartCapabilities["protectedFiles"]["verifyOwnerOnly"];
    readonly readProtectedFile?: StartCapabilities["protectedFiles"]["readOwnerOnly"];
    readonly removeProtectedFile?: StartCapabilities["protectedFiles"]["removeWithin"];
  } = {},
): {
  readonly capabilities: StartCapabilities;
  readonly processRun: ReturnType<typeof vi.fn<StartCapabilities["process"]["run"]>>;
  readonly statePublication: LiveDemoDatabaseStatePublication;
  readonly artifactPublication: LiveDemoDatabaseArtifactPublication<object>;
  readonly provision: ReturnType<
    typeof vi.fn<
      StartCapabilities["ownership"]["provisionExclusiveDisposablePostgresDatabaseOwnership"]
    >
  >;
  readonly attest: ReturnType<
    typeof vi.fn<
      ReturnType<StartCapabilities["ownership"]["createDisposablePostgresOwner"]>["attestOwnership"]
    >
  >;
  readonly events: string[];
  readonly protectedFiles: StartCapabilities["protectedFiles"];
} {
  const events: string[] = [];
  let serializedState: string | undefined;
  const defaultRun: StartCapabilities["process"]["run"] = async (request) => {
    const action = request.arguments[0];
    events.push(`process:${action ?? "unknown"}`);
    if (request.executable === "docker" && action === "create") {
      return { exitCode: 0, stdout: `${containerId}\n` };
    }
    if (request.executable === "docker" && action === "inspect") {
      return { exitCode: 0, stdout: inspectOutput("healthy") };
    }
    if (request.executable === "docker" && (action === "start" || action === "rm")) {
      return { exitCode: 0, stdout: "" };
    }
    if (request.executable === "docker" && action === "ps") {
      return { exitCode: 0, stdout: "" };
    }
    if (request.arguments.includes("migrate") && request.arguments.includes("deploy")) {
      events.push("migrate");
      return { exitCode: 0, stdout: "" };
    }
    return { exitCode: 1, stdout: "" };
  };
  const processRun = vi.fn(overrides.run ?? defaultRun);
  const replaceAtomically = vi.fn(
    overrides.replaceAtomically ??
      (async ({
        expectedSerializedState,
        nextSerializedState,
      }: Readonly<{ expectedSerializedState: string; nextSerializedState: string }>) => {
        events.push(`state:${JSON.parse(nextSerializedState).checkpoint as string}`);
        if (serializedState !== expectedSerializedState) return false;
        serializedState = nextSerializedState;
        return true;
      }),
  );
  const statePublication: LiveDemoDatabaseStatePublication = {
    createExclusive: vi.fn(async (value) => {
      events.push("state:state_created");
      if (serializedState !== undefined) return false;
      serializedState = value;
      return true;
    }),
    replaceAtomically,
  };
  const staged = Object.freeze({ id: "opaque-staging-handle" });
  const artifactPublication: LiveDemoDatabaseArtifactPublication<object> = {
    stage: vi.fn(async () => {
      events.push("artifacts:stage");
      return staged;
    }),
    setOwnerOnlyPermissions: vi.fn(async () => {
      events.push("artifacts:protect");
    }),
    verifyOwnerOnlyPermissions: vi.fn(
      overrides.verifyPermissions ??
        (async () => {
          events.push("artifacts:verify");
          return true;
        }),
    ),
    publishAtomically: vi.fn(async () => {
      events.push("artifacts:publish");
    }),
    discard: vi.fn(async () => undefined),
  };
  const provision = vi.fn(
    overrides.provision ??
      (async (input) => {
        events.push("seal");
        return Object.freeze({
          version: 1 as const,
          databaseName,
          databaseOid: "16384",
          clusterSystemIdentifier: "7441111111111111111",
          ownershipToken: input.ownershipToken,
          exclusive: true as const,
        });
      }),
  );
  const attest = vi.fn(
    overrides.attest ??
      (async () => {
        events.push("attest");
        return Object.freeze({
          outcome: "owned" as const,
          exclusive: true as const,
          provisioningOwnershipDigest: digest,
        });
      }),
  );
  const protectedFiles: StartCapabilities["protectedFiles"] = {
    createOwnerOnlyExclusive: vi.fn(
      overrides.createProtectedFile ??
        (async () => {
          events.push("protected:create-labels");
          return true;
        }),
    ),
    protectExisting: vi.fn(
      overrides.protectExisting ??
        (async () => {
          events.push("protected:protect-cid");
          return true;
        }),
    ),
    verifyOwnerOnly: vi.fn(
      overrides.verifyProtectedFile ??
        (async () => {
          events.push("protected:verify");
          return true;
        }),
    ),
    readOwnerOnly: vi.fn(overrides.readProtectedFile ?? (async () => `${containerId}\n`)),
    removeWithin: vi.fn(
      overrides.removeProtectedFile ??
        (async () => {
          events.push("protected:remove");
          return true;
        }),
    ),
  };
  const capabilities: StartCapabilities = {
    identity: {
      createSessionId: vi.fn(() => sessionId),
      nowIso: vi.fn(() => createdAt),
      createDatabaseSuffix: vi.fn(() => suffix),
      createPassword: vi.fn(() => password),
      createOwnershipToken: vi.fn((purpose) =>
        purpose === "container" ? containerOwnershipToken : databaseOwnershipToken,
      ),
      createHostPort: vi.fn(() => hostPort),
    },
    process: { run: processRun },
    wait: vi.fn(async () => undefined),
    protectedFiles,
    statePublication,
    artifactPublication,
    ownership: {
      provisionExclusiveDisposablePostgresDatabaseOwnership: provision,
      createDisposablePostgresOwner: vi.fn((_connectionString, input) => ({
        attestOwnership: async () => {
          await input.loadProvisioningAttestation();
          return await attest();
        },
      })),
    },
  };
  return {
    capabilities,
    processRun,
    statePublication,
    artifactPublication,
    provision,
    attest,
    events,
    protectedFiles,
  };
}

function requestsFor(
  processRun: ReturnType<typeof vi.fn<StartCapabilities["process"]["run"]>>,
  executable: string,
  action?: string,
): ProcessRequest[] {
  return processRun.mock.calls
    .map(([request]) => request)
    .filter(
      (request) =>
        request.executable === executable &&
        (action === undefined || request.arguments[0] === action),
    );
}

describe("disposable live-demo database start", () => {
  it("keeps the concrete PostgreSQL adapter outside CLI orchestration", () => {
    const source = readFileSync(new URL("./live-demo-database-start.ts", import.meta.url), "utf8");

    expect(source).not.toContain("@muster/infrastructure-postgres");
  });

  it("creates only the pinned labeled loopback-bound tmpfs container without secrets in argv", async () => {
    const api = await loadApi();
    const harness = createHarness();

    await api.startLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities });

    expect(harness.events.indexOf("state:state_created")).toBeLessThan(
      harness.events.indexOf("process:create"),
    );
    expect(
      JSON.parse(vi.mocked(harness.statePublication.createExclusive).mock.calls[0]?.[0] ?? "null"),
    ).toMatchObject({
      checkpoint: "state_created",
      containerIntent: {
        name: containerName,
        image: pinnedImage,
        ownershipToken: containerOwnershipToken,
        binding: { host: "127.0.0.1", hostPort, containerPort: 5432 },
        storage: "tmpfs",
      },
      container: null,
    });
    const [request] = requestsFor(harness.processRun, "docker", "create");
    expect(request).toMatchObject({
      executable: "docker",
      cwd: repositoryRoot,
      timeoutMs: 30_000,
      output: "capture_suppressed",
    });
    expect(request?.arguments).toEqual([
      "create",
      "--name",
      containerName,
      "--cidfile",
      cidFilePath,
      "--label-file",
      labelFilePath,
      "--publish",
      `127.0.0.1:${hostPort}:5432`,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=536870912",
      "--env",
      "POSTGRES_USER",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_DB",
      "--health-cmd",
      "pg_isready",
      "--health-interval",
      "1s",
      "--health-timeout",
      "2s",
      "--health-retries",
      "30",
      "--health-start-period",
      "2s",
      api.LIVE_DEMO_DATABASE_PINNED_IMAGE,
    ]);
    expect(request?.environment).toEqual({
      POSTGRES_DB: databaseName,
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: databaseOwner,
    });
    expect(request?.standardInput).toBeUndefined();
    expect(harness.protectedFiles.createOwnerOnlyExclusive).toHaveBeenCalledWith({
      path: labelFilePath,
      contents:
        `com.muster.live-demo-database.session=${sessionId}\n` +
        `com.muster.live-demo-database.owner=${containerOwnershipToken}\n`,
    });
    expect(harness.protectedFiles.verifyOwnerOnly).toHaveBeenCalledWith(labelFilePath);
    expect(harness.protectedFiles.removeWithin).toHaveBeenCalledWith(labelFilePath, 2_000);
    const serializedArguments = JSON.stringify(request?.arguments);
    for (const secret of [
      password,
      containerOwnershipToken,
      databaseOwnershipToken,
      databaseName,
      databaseOwner,
    ]) {
      expect(serializedArguments).not.toContain(secret);
    }
    expect(request?.arguments).not.toContain("-");
    expect(requestsFor(harness.processRun, "docker", "create")).toHaveLength(1);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", " \r\n"],
    ["malformed", "not-a-container-id\n"],
  ] as const)(
    "retains state_created and never retries when the protected CID is %s",
    async (_case, protectedCid) => {
      const api = await loadApi();
      const harness = createHarness({ readProtectedFile: async () => protectedCid });

      const result = await api.startLiveDemoDatabase({
        repositoryRoot,
        capabilities: harness.capabilities,
      });

      expect(result).toEqual({
        outcome: "blocked",
        message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
      });
      const createRequests = requestsFor(harness.processRun, "docker", "create");
      expect(createRequests).toHaveLength(1);
      expect(createRequests[0]?.timeoutMs).toBe(30_000);
      expect(requestsFor(harness.processRun, "docker", "inspect")).toHaveLength(0);
      expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(0);
      const retained = vi.mocked(harness.statePublication.replaceAtomically).mock.calls.at(-1)?.[0];
      expect(JSON.parse(retained?.nextSerializedState ?? "null")).toMatchObject({
        status: "cleanup_required",
        checkpoint: "state_created",
        container: null,
      });
    },
  );

  it("refuses Docker creation unless the temporary label file is owner-only and removes it boundedly", async () => {
    const api = await loadApi();
    const harness = createHarness({
      verifyProtectedFile: async (candidatePath) => candidatePath !== labelFilePath,
    });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(requestsFor(harness.processRun, "docker", "create")).toHaveLength(0);
    expect(harness.protectedFiles.removeWithin).toHaveBeenCalledWith(labelFilePath, 2_000);
  });

  it("fails closed when bounded temporary label-file cleanup is uncertain", async () => {
    const api = await loadApi();
    const harness = createHarness({
      removeProtectedFile: async (candidatePath) => candidatePath !== labelFilePath,
    });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(harness.artifactPublication.stage).not.toHaveBeenCalled();
  });

  it.each([
    ["throws", true],
    ["returns malformed output", false],
  ] as const)(
    "recovers exact container proof from the durable cidfile when create %s",
    async (_case, throws) => {
      const api = await loadApi();
      const harness = createHarness({
        run: async (request) => {
          if (request.arguments[0] === "create") {
            if (throws) throw new Error("create diagnostics must remain hidden");
            return { exitCode: 0, stdout: "malformed-create-output" };
          }
          if (request.arguments[0] === "inspect") {
            return { exitCode: 0, stdout: inspectOutput("created") };
          }
          if (request.arguments[0] === "rm") return { exitCode: 0, stdout: "" };
          if (request.arguments[0] === "ps") return { exitCode: 0, stdout: "" };
          return { exitCode: 1, stdout: "" };
        },
      });

      const result = await api.startLiveDemoDatabase({
        repositoryRoot,
        capabilities: harness.capabilities,
      });

      expect(result).toEqual({
        outcome: "cleanup_required",
        message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
      });
      expect(harness.protectedFiles.protectExisting).toHaveBeenCalledWith(cidFilePath);
      expect(harness.protectedFiles.readOwnerOnly).toHaveBeenCalledWith(cidFilePath, 128);
      const transitions = vi
        .mocked(harness.statePublication.replaceAtomically)
        .mock.calls.map(([call]) => JSON.parse(call.nextSerializedState));
      expect(transitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            checkpoint: "container_created",
            container: expect.objectContaining({ id: containerId }),
          }),
          expect.objectContaining({ status: "cleanup_required", checkpoint: "container_created" }),
        ]),
      );
      expect(requestsFor(harness.processRun, "docker", "rm")[0]?.arguments).toEqual([
        "rm",
        "--force",
        containerId,
      ]);
      expect(requestsFor(harness.processRun, "docker", "ps")).toHaveLength(1);
    },
  );

  it("retains exact proof and never claims rollback when docker rm fails or removal cannot be verified", async () => {
    const api = await loadApi();
    const harness = createHarness({
      run: async (request) => {
        if (request.arguments[0] === "create") return { exitCode: 0, stdout: `${containerId}\n` };
        if (request.arguments[0] === "inspect") {
          return { exitCode: 0, stdout: inspectOutput("created") };
        }
        if (request.arguments[0] === "start") return { exitCode: 1, stdout: "" };
        if (request.arguments[0] === "rm") return { exitCode: 1, stdout: "" };
        return { exitCode: 1, stdout: "" };
      },
    });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "cleanup_required",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(requestsFor(harness.processRun, "docker", "ps")).toHaveLength(0);
    const retained = vi.mocked(harness.statePublication.replaceAtomically).mock.calls.at(-1)?.[0];
    expect(JSON.parse(retained?.nextSerializedState ?? "null")).toMatchObject({
      status: "cleanup_required",
      checkpoint: "container_created",
      container: { id: containerId },
    });
  });

  it("retains cidfile intent and blocks without destructive rollback when full proof cannot persist", async () => {
    const api = await loadApi();
    const harness = createHarness({ replaceAtomically: async () => false });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(harness.protectedFiles.readOwnerOnly).toHaveBeenCalledWith(cidFilePath, 128);
    expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(0);
    expect(harness.protectedFiles.removeWithin).not.toHaveBeenCalledWith(cidFilePath, 2_000);
  });

  it("persists immutable container proof before start and uses only the returned exact id", async () => {
    const api = await loadApi();
    const harness = createHarness();

    await api.startLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities });

    expect(harness.events.indexOf("state:container_created")).toBeLessThan(
      harness.events.indexOf("process:start"),
    );
    const transition = vi.mocked(harness.statePublication.replaceAtomically).mock.calls[0]?.[0];
    expect(JSON.parse(transition?.nextSerializedState ?? "null")).toMatchObject({
      status: "starting",
      checkpoint: "container_created",
      container: {
        id: containerId,
        name: containerName,
        image: pinnedImage,
        ownershipToken: containerOwnershipToken,
        binding: { host: "127.0.0.1", hostPort, containerPort: 5432 },
        storage: "tmpfs",
      },
    });
    expect(requestsFor(harness.processRun, "docker", "start")[0]?.arguments).toEqual([
      "start",
      containerId,
    ]);
  });

  it("bounds readiness attempts and delay before returning attention", async () => {
    const api = await loadApi();
    let inspections = 0;
    const harness = createHarness({
      run: async (request) => {
        if (request.arguments[0] === "create") return { exitCode: 0, stdout: `${containerId}\n` };
        if (request.arguments[0] === "start") return { exitCode: 0, stdout: "" };
        if (request.arguments[0] === "inspect") {
          inspections += 1;
          return { exitCode: 0, stdout: inspectOutput("starting") };
        }
        if (request.arguments[0] === "rm") return { exitCode: 0, stdout: "" };
        return { exitCode: 1, stdout: "" };
      },
    });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "cleanup_required",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(inspections).toBe(32); // Pre-persist proof, 30 readiness checks, and exact rollback proof.
    expect(harness.capabilities.wait).toHaveBeenCalledTimes(29);
    expect(harness.provision).not.toHaveBeenCalled();
  });

  it("seals the empty database before migrations and re-attests exact ownership afterward", async () => {
    const api = await loadApi();
    const harness = createHarness();

    await api.startLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities });

    expect(harness.events.indexOf("seal")).toBeLessThan(harness.events.indexOf("migrate"));
    expect(harness.events.indexOf("migrate")).toBeLessThan(harness.events.indexOf("attest"));
    expect(harness.events.indexOf("attest")).toBeLessThan(
      harness.events.indexOf("state:database_owned"),
    );
    expect(harness.provision).toHaveBeenCalledWith({
      connectionString: `postgresql://${databaseOwner}:${password}@127.0.0.1:${hostPort}/${databaseName}`,
      ownershipToken: databaseOwnershipToken,
    });
    expect(harness.attest).toHaveBeenCalledOnce();
  });

  it("deploys committed migrations with suppressed output and the connection only in child environment", async () => {
    const api = await loadApi();
    const harness = createHarness();

    await api.startLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities });

    const migrationRequests = harness.processRun.mock.calls
      .map(([request]) => request)
      .filter(
        (request) => request.arguments.includes("migrate") && request.arguments.includes("deploy"),
      );
    expect(migrationRequests).toHaveLength(1);
    const [request] = migrationRequests;
    expect(request).toMatchObject({ cwd: repositoryRoot, output: "ignore" });
    expect(request?.executable).toMatch(/node(?:\.exe)?$/u);
    expect(request?.arguments.at(-2)).toBe("migrate");
    expect(request?.arguments.at(-1)).toBe("deploy");
    expect(request?.environment).toEqual({
      MIGRATION_DATABASE_URL: `postgresql://${databaseOwner}:${password}@127.0.0.1:${hostPort}/${databaseName}`,
    });
    expect(JSON.stringify(request?.arguments)).not.toContain(password);
  });

  it("publishes activation material only after exact ownership read-back and records the digest", async () => {
    const api = await loadApi();
    const harness = createHarness();

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "ready",
      message: api.LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
      activationScript: path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "activate.ps1",
      ),
    });
    expect(harness.events.indexOf("state:database_owned")).toBeLessThan(
      harness.events.indexOf("artifacts:stage"),
    );
    const databaseOwnedTransition = vi
      .mocked(harness.statePublication.replaceAtomically)
      .mock.calls.map(([call]) => JSON.parse(call.nextSerializedState))
      .find((state) => state.checkpoint === "database_owned");
    expect(databaseOwnedTransition).toMatchObject({
      database: {
        databaseName,
        databaseOwner,
        provisioningOwnershipDigest: digest,
        attestationVersion: 1,
      },
    });
    const stagedArtifacts = vi.mocked(harness.artifactPublication.stage).mock.calls[0]?.[0];
    expect(stagedArtifacts?.map((artifact) => artifact.path)).toEqual([
      path.join(repositoryRoot, ".generated-tmp", "live-demo-database", "database-url.txt"),
      path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "provisioning-attestation.json",
      ),
      path.join(repositoryRoot, ".generated-tmp", "live-demo-database", "activate.ps1"),
    ]);
  });

  it("persists owner-only recovery material before the database_owned lifecycle checkpoint", async () => {
    const api = await loadApi();
    const harness = createHarness();

    await api.startLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities });

    const recoveryCall = vi
      .mocked(harness.protectedFiles.createOwnerOnlyExclusive)
      .mock.calls.find(([input]) => input.path === recoveryMaterialPath);
    expect(recoveryCall).toBeDefined();
    expect(JSON.parse(recoveryCall?.[0].contents ?? "null")).toEqual({
      version: 1,
      databaseUrl: `postgresql://${databaseOwner}:${password}@127.0.0.1:${hostPort}/${databaseName}`,
      provisioningAttestation: {
        version: 1,
        databaseName,
        databaseOid: "16384",
        clusterSystemIdentifier: "7441111111111111111",
        ownershipToken: databaseOwnershipToken,
        exclusive: true,
      },
    });
    expect(harness.protectedFiles.verifyOwnerOnly).toHaveBeenCalledWith(recoveryMaterialPath);
    expect(harness.protectedFiles.removeWithin).toHaveBeenCalledWith(recoveryMaterialPath, 2_000);
    const recoveryInvocation = vi.mocked(harness.protectedFiles.createOwnerOnlyExclusive).mock
      .invocationCallOrder[1];
    const databaseTransitionInvocation = vi
      .mocked(harness.statePublication.replaceAtomically)
      .mock.calls.findIndex(
        ([call]) => JSON.parse(call.nextSerializedState).checkpoint === "database_owned",
      );
    expect(recoveryInvocation).toBeLessThan(
      vi.mocked(harness.statePublication.replaceAtomically).mock.invocationCallOrder[
        databaseTransitionInvocation
      ],
    );
    const recoveryRemovalIndex = vi
      .mocked(harness.protectedFiles.removeWithin)
      .mock.calls.findIndex(([candidatePath]) => candidatePath === recoveryMaterialPath);
    const recoveryRemovalInvocation = vi.mocked(harness.protectedFiles.removeWithin).mock
      .invocationCallOrder[recoveryRemovalIndex];
    const readyTransitionIndex = vi
      .mocked(harness.statePublication.replaceAtomically)
      .mock.calls.findIndex(
        ([call]) => JSON.parse(call.nextSerializedState).checkpoint === "artifacts_published",
      );
    expect(recoveryRemovalInvocation).toBeLessThan(
      vi.mocked(harness.statePublication.replaceAtomically).mock.invocationCallOrder[
        readyTransitionIndex
      ],
    );
  });

  it.each([
    [
      "creation",
      {
        createProtectedFile: async (input: { readonly path: string }) =>
          input.path !== recoveryMaterialPath,
      },
    ],
    [
      "permission verification",
      {
        verifyProtectedFile: async (candidatePath: string) =>
          candidatePath !== recoveryMaterialPath,
      },
    ],
  ] as const)(
    "retains database ownership authority when recovery-file %s fails after sealing",
    async (_failure, overrides) => {
      const api = await loadApi();
      const harness = createHarness(overrides);

      const result = await api.startLiveDemoDatabase({
        repositoryRoot,
        capabilities: harness.capabilities,
      });

      expect(result).toEqual({
        outcome: "cleanup_required",
        message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
      });
      expect(harness.provision).toHaveBeenCalledOnce();
      expect(harness.attest).toHaveBeenCalledOnce();
      expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(0);
      const transitions = vi
        .mocked(harness.statePublication.replaceAtomically)
        .mock.calls.map(([call]) => JSON.parse(call.nextSerializedState));
      expect(transitions.at(-2)).toMatchObject({
        status: "starting",
        checkpoint: "database_owned",
        database: {
          databaseName,
          databaseOwner,
          provisioningOwnershipDigest: digest,
          attestationVersion: 1,
        },
      });
      expect(transitions.at(-1)).toMatchObject({
        status: "cleanup_required",
        checkpoint: "database_owned",
      });
      expect(harness.artifactPublication.stage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["container create", "create"],
    ["container start", "start"],
    ["migration", "migrate"],
  ] as const)("retains recovery state when %s fails", async (_label, failure) => {
    const api = await loadApi();
    const harness = createHarness({
      run: async (request) => {
        const action = request.arguments[0];
        if (action === "create") {
          return failure === "create"
            ? { exitCode: 1, stdout: "sensitive docker failure" }
            : { exitCode: 0, stdout: `${containerId}\n` };
        }
        if (action === "start") {
          return failure === "start" ? { exitCode: 1, stdout: "" } : { exitCode: 0, stdout: "" };
        }
        if (action === "inspect") return { exitCode: 0, stdout: inspectOutput("healthy") };
        if (action === "rm") return { exitCode: 0, stdout: "" };
        if (request.arguments.includes("migrate") && request.arguments.includes("deploy")) {
          return failure === "migrate"
            ? { exitCode: 1, stdout: "secret migration diagnostics" }
            : { exitCode: 0, stdout: "" };
        }
        return { exitCode: 1, stdout: "" };
      },
    });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "cleanup_required",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(JSON.stringify(result)).not.toContain(password);
    expect(requestsFor(harness.processRun, "docker", "rm")[0]?.arguments).toEqual([
      "rm",
      "--force",
      containerId,
    ]);
  });

  it("never removes a container when exact inspection mismatches retained proof", async () => {
    const api = await loadApi();
    let inspection = 0;
    const harness = createHarness({
      run: async (request) => {
        if (request.arguments[0] === "create") return { exitCode: 0, stdout: `${containerId}\n` };
        if (request.arguments[0] === "start") return { exitCode: 1, stdout: "" };
        if (request.arguments[0] === "inspect") {
          inspection += 1;
          const parsed = JSON.parse(inspectOutput("healthy")) as Record<string, unknown>;
          if (inspection === 1) {
            (parsed["Config"] as { Labels: Record<string, string> }).Labels[
              "com.muster.live-demo-database.owner"
            ] = "E".repeat(43);
          }
          return { exitCode: 0, stdout: JSON.stringify(parsed) };
        }
        return { exitCode: 1, stdout: "" };
      },
    });

    await api.startLiveDemoDatabase({ repositoryRoot, capabilities: harness.capabilities });

    expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(0);
  });

  it.each(["mismatch", "missing", "indeterminate"] as const)(
    "rejects %s ownership read-back before publication",
    async (outcome) => {
      const api = await loadApi();
      const harness = createHarness({ attest: async () => ({ outcome }) });

      const result = await api.startLiveDemoDatabase({
        repositoryRoot,
        capabilities: harness.capabilities,
      });

      expect(result).toEqual({
        outcome: "cleanup_required",
        message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
      });
      expect(harness.artifactPublication.stage).not.toHaveBeenCalled();
      expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(1);
    },
  );

  it("retains the sealed database recovery authority when the database_owned lifecycle write fails", async () => {
    const api = await loadApi();
    let replacements = 0;
    const harness = createHarness({
      replaceAtomically: async () => {
        replacements += 1;
        return replacements !== 2;
      },
    });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "blocked",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(harness.provision).toHaveBeenCalledOnce();
    expect(harness.attest).toHaveBeenCalledOnce();
    expect(harness.protectedFiles.createOwnerOnlyExclusive).toHaveBeenCalledWith(
      expect.objectContaining({ path: recoveryMaterialPath }),
    );
    expect(harness.protectedFiles.verifyOwnerOnly).toHaveBeenCalledWith(recoveryMaterialPath);
    expect(harness.protectedFiles.removeWithin).not.toHaveBeenCalledWith(
      recoveryMaterialPath,
      2_000,
    );
    expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(0);
    expect(harness.artifactPublication.stage).not.toHaveBeenCalled();
  });

  it("retains database-owned recovery state when protected artifact publication fails", async () => {
    const api = await loadApi();
    const harness = createHarness({ verifyPermissions: async () => false });

    const result = await api.startLiveDemoDatabase({
      repositoryRoot,
      capabilities: harness.capabilities,
    });

    expect(result).toEqual({
      outcome: "cleanup_required",
      message: api.LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
    });
    expect(requestsFor(harness.processRun, "docker", "rm")).toHaveLength(0);
    const finalTransition = vi
      .mocked(harness.statePublication.replaceAtomically)
      .mock.calls.at(-1)?.[0];
    expect(JSON.parse(finalTransition?.nextSerializedState ?? "null")).toMatchObject({
      status: "cleanup_required",
      checkpoint: "database_owned",
      database: { provisioningOwnershipDigest: digest },
    });
  });
});

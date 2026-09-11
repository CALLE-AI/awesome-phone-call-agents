import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createLiveDemoDatabasePaths } from "../cli/live-demo-database-contract.js";
import {
  disposeLiveDemoDatabase,
  type LiveDemoDatabaseDisposeCapabilities,
} from "../cli/live-demo-database-dispose.js";
import { inspectProviderFreeSourceIsolation } from "../../../../tools/architecture/provider-free-isolation-policy.js";
import { runProviderFreePrepareVerification } from "../cli/live-smoke-prepare-verification-runtime.js";
import {
  startLiveDemoDatabase,
  type LiveDemoDatabaseProcessRequest,
} from "../cli/live-demo-database-start.js";
import {
  LIVE_DEMO_DATABASE_PINNED_IMAGE,
  createInitialLiveDemoDatabaseLifecycleState,
  parseLiveDemoDatabaseLifecycleState,
  serializeLiveDemoDatabaseLifecycleState,
  transitionLiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseLifecycleState,
} from "../cli/live-demo-database-state.js";
import { createLiveDemoDatabaseOperatorRuntime } from "./live-demo-database-operator-runtime.js";

const enabled = process.env["MUSTER_RUN_LIVE_DEMO_DATABASE_INTEGRATION"] === "1";
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const recoveryRootPrefix = "muster-live-demo-database-recovery-";
const containerIdPattern = /^[0-9a-f]{64}$/u;
const tmpfsSpecification = "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=536870912";
const tmpfsValue = "rw,noexec,nosuid,nodev,size=536870912";
const safeCleanupInspectFormat =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"HostConfig":{"Binds":{{json .HostConfig.Binds}},"PortBindings":{{json .HostConfig.PortBindings}},"Tmpfs":{{json .HostConfig.Tmpfs}}},"Mounts":{{json .Mounts}}}';
const recoveryProcessTimeoutMs = 10_000;
const recoveryInspectTimeoutMs = 2_000;
const recoveryBoundaryError = "database recovery isolation boundary rejected a capability";

interface RecoveryFixture {
  readonly repositoryRoot: string;
  readonly paths: ReturnType<typeof createLiveDemoDatabasePaths>;
  readonly runtime: ReturnType<typeof createLiveDemoDatabaseOperatorRuntime>;
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly sessionId: string;
  readonly containerName: string;
  readonly ownershipToken: string;
  readonly hostPort: number;
  containerId: string | undefined;
}

interface ObservedDisposal {
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
  readonly requests: readonly LiveDemoDatabaseProcessRequest[];
  readonly waitDurations: readonly number[];
  readonly stateObservedBeforeRemove: () => LiveDemoDatabaseLifecycleState | undefined;
  readonly isolationEvidence: () => RecoveryIsolationEvidence;
}

type ProviderActivityKind = "providerConstructions" | "externalCalls" | "calls";

type ProviderActivity = Readonly<Record<ProviderActivityKind, number>>;

type RecoveryScenario = "stable_absence" | "exact_candidate";

type RecoveryProcessKind =
  "name_snapshot" | "session_snapshot" | "strict_inspect" | "exact_remove" | "id_absence";

interface RecoverySourceBundle {
  readonly contract: string;
  readonly lifecycle: string;
  readonly state: string;
  readonly start: string;
  readonly dispose: string;
  readonly runtime: string;
  readonly disposeOwnership: string;
  readonly startOwnership: string;
}

interface RecoveryStructuralIsolationEvidence {
  readonly outcome: "PASS" | "BLOCKED";
  readonly auditedModules: readonly string[];
  readonly violations: readonly string[];
  readonly capabilityFindings: ProviderActivity;
}

interface RecoveryIsolationEvidence {
  readonly outcome: "PASS" | "BLOCKED";
  readonly structuralIsolation: RecoveryStructuralIsolationEvidence;
  readonly processBoundary: Readonly<{
    outcome: "PASS" | "BLOCKED";
    observedKinds: readonly RecoveryProcessKind[];
    rejectedRequests: number;
  }>;
  readonly capabilityBudget: ProviderActivity;
}

interface RecoveryIsolationMembrane {
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
  readonly report: () => RecoveryIsolationEvidence;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === "string") {
    throw new Error("test-owned loopback port unavailable");
  }
  return address.port;
}

function dockerRequest(
  fixture: RecoveryFixture,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): LiveDemoDatabaseProcessRequest {
  return Object.freeze({
    executable: "docker",
    arguments: Object.freeze([...arguments_]),
    cwd: fixture.repositoryRoot,
    environment: Object.freeze({ ...environment }),
    timeoutMs: 60_000,
    output: "capture_suppressed" as const,
  });
}

function canonicalIds(serialized: string): readonly string[] | undefined {
  if (serialized === "") return Object.freeze([]);
  const lines = serialized.endsWith("\n")
    ? serialized.slice(0, -1).split(/\r?\n/u)
    : serialized.split(/\r?\n/u);
  return lines.length > 0 && lines.every((line) => containerIdPattern.test(line))
    ? Object.freeze(lines)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isExactCleanupContainer(
  serialized: string,
  fixture: RecoveryFixture,
  candidateId: string,
): boolean {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["Id", "Name", "Config", "HostConfig", "Mounts"])
    ) {
      return false;
    }
    const config = value["Config"];
    const hostConfig = value["HostConfig"];
    const mounts = value["Mounts"];
    if (
      !isRecord(config) ||
      !hasExactKeys(config, ["Image", "Labels"]) ||
      !isRecord(hostConfig) ||
      !hasExactKeys(hostConfig, ["Binds", "PortBindings", "Tmpfs"]) ||
      !Array.isArray(mounts) ||
      mounts.length !== 0
    ) {
      return false;
    }
    const labels = config["Labels"];
    const binds = hostConfig["Binds"];
    const bindings = hostConfig["PortBindings"];
    const tmpfs = hostConfig["Tmpfs"];
    if (
      !isRecord(labels) ||
      !hasExactKeys(labels, [
        "com.muster.live-demo-database.session",
        "com.muster.live-demo-database.owner",
      ]) ||
      (binds !== null && (!Array.isArray(binds) || binds.length !== 0)) ||
      !isRecord(bindings) ||
      !hasExactKeys(bindings, ["5432/tcp"]) ||
      !isRecord(tmpfs) ||
      !hasExactKeys(tmpfs, ["/var/lib/postgresql/data"])
    ) {
      return false;
    }
    const binding = bindings["5432/tcp"];
    return (
      value["Id"] === candidateId &&
      value["Name"] === `/${fixture.containerName}` &&
      config["Image"] === LIVE_DEMO_DATABASE_PINNED_IMAGE &&
      labels["com.muster.live-demo-database.session"] === fixture.sessionId &&
      labels["com.muster.live-demo-database.owner"] === fixture.ownershipToken &&
      Array.isArray(binding) &&
      binding.length === 1 &&
      isRecord(binding[0]) &&
      hasExactKeys(binding[0], ["HostIp", "HostPort"]) &&
      binding[0]["HostIp"] === "127.0.0.1" &&
      binding[0]["HostPort"] === String(fixture.hostPort) &&
      tmpfs["/var/lib/postgresql/data"] === tmpfsValue
    );
  } catch {
    return false;
  }
}

async function queryExactIds(
  fixture: RecoveryFixture,
  selector: string,
): Promise<readonly string[]> {
  const result = await fixture.runtime.dispose.process.run(
    dockerRequest(fixture, [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      selector,
      "--format",
      "{{.ID}}",
    ]),
  );
  const ids = canonicalIds(result.stdout);
  if (result.exitCode !== 0 || ids === undefined) {
    throw new Error("exact test-owned Docker residue query failed");
  }
  return ids;
}

async function discoverExactTestContainerId(fixture: RecoveryFixture): Promise<string | undefined> {
  const [byName, bySession] = await Promise.all([
    queryExactIds(fixture, `name=^/${fixture.containerName}$`),
    queryExactIds(fixture, `label=com.muster.live-demo-database.session=${fixture.sessionId}`),
  ]);
  if (byName.length === 0 && bySession.length === 0) return undefined;
  if (byName.length !== 1 || bySession.length !== 1 || byName[0] !== bySession[0]) {
    throw new Error("test-owned Docker identity is ambiguous");
  }
  return byName[0];
}

async function removeAndAssertExactTestContainerAbsent(fixture: RecoveryFixture): Promise<void> {
  let candidateId: string | undefined;
  if (fixture.containerId !== undefined) {
    const byId = await queryExactIds(fixture, `id=${fixture.containerId}`);
    if (byId.length > 1 || (byId.length === 1 && byId[0] !== fixture.containerId)) {
      throw new Error("test-owned Docker ID query was ambiguous");
    }
    candidateId = byId[0];
  } else {
    candidateId = await discoverExactTestContainerId(fixture);
  }
  if (candidateId !== undefined) {
    const inspected = await fixture.runtime.dispose.process.run(
      dockerRequest(fixture, [
        "inspect",
        "--type",
        "container",
        "--format",
        safeCleanupInspectFormat,
        candidateId,
      ]),
    );
    if (
      inspected.exitCode !== 0 ||
      !isExactCleanupContainer(inspected.stdout, fixture, candidateId)
    ) {
      throw new Error("test-owned Docker identity could not be proven for cleanup");
    }
    const removed = await fixture.runtime.dispose.process.run(
      dockerRequest(fixture, ["rm", "--force", candidateId]),
    );
    if (removed.exitCode !== 0) throw new Error("exact test-owned Docker cleanup failed");
  }

  const checks = [
    ...(fixture.containerId === undefined
      ? []
      : [await queryExactIds(fixture, `id=${fixture.containerId}`)]),
    await queryExactIds(fixture, `name=^/${fixture.containerName}$`),
    await queryExactIds(
      fixture,
      `label=com.muster.live-demo-database.session=${fixture.sessionId}`,
    ),
  ];
  if (checks.some((ids) => ids.length !== 0)) {
    throw new Error("exact test-owned Docker residue remained");
  }
}

async function removeIsolatedRecoveryRoot(repositoryRoot_: string): Promise<void> {
  const resolved = path.resolve(repositoryRoot_);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith(recoveryRootPrefix)
  ) {
    throw new Error("refusing to remove a non-test recovery root");
  }
  await rm(resolved, { recursive: true, force: true });
}

async function cleanupRecoveryFixture(fixture: RecoveryFixture): Promise<void> {
  await removeAndAssertExactTestContainerAbsent(fixture);
  await removeIsolatedRecoveryRoot(fixture.repositoryRoot);
}

async function createRecoveryFixture(): Promise<RecoveryFixture> {
  const isolatedRepositoryRoot = await mkdtemp(path.join(tmpdir(), recoveryRootPrefix));
  const runtime = createLiveDemoDatabaseOperatorRuntime(isolatedRepositoryRoot);
  const sessionId = randomUUID();
  const ownershipToken = randomBytes(32).toString("base64url");
  const hostPort = await availablePort();
  const containerName = `muster-live-demo-database-${sessionId}`;
  const initial = createInitialLiveDemoDatabaseLifecycleState({
    sessionId,
    createdAt: new Date().toISOString(),
    containerIntent: {
      name: containerName,
      image: LIVE_DEMO_DATABASE_PINNED_IMAGE,
      ownershipToken,
      labels: {
        "com.muster.live-demo-database.session": sessionId,
        "com.muster.live-demo-database.owner": ownershipToken,
      },
      binding: { host: "127.0.0.1", hostPort, containerPort: 5432 },
      storage: "tmpfs",
    },
  });
  const state = transitionLiveDemoDatabaseLifecycleState(initial, {
    status: "cleanup_required",
    checkpoint: "state_created",
  });
  const fixture: RecoveryFixture = {
    repositoryRoot: isolatedRepositoryRoot,
    paths: createLiveDemoDatabasePaths(isolatedRepositoryRoot),
    runtime,
    state,
    sessionId,
    containerName,
    ownershipToken,
    hostPort,
    containerId: undefined,
  };
  try {
    if (
      !(await runtime.start.statePublication.createExclusive(
        serializeLiveDemoDatabaseLifecycleState(state),
      ))
    ) {
      throw new Error("test-owned lifecycle state could not be created");
    }
    const labelsCreated = await runtime.start.protectedFiles.createOwnerOnlyExclusive({
      path: path.join(fixture.paths.root, "container-labels.tmp"),
      contents:
        `com.muster.live-demo-database.session=${sessionId}\n` +
        `com.muster.live-demo-database.owner=${ownershipToken}\n`,
    });
    const cidCreated = await runtime.start.protectedFiles.createOwnerOnlyExclusive({
      path: path.join(fixture.paths.root, "container.cid"),
      contents: "",
    });
    if (!labelsCreated || !cidCreated) {
      throw new Error("test-owned pre-create recovery material could not be created");
    }
    return fixture;
  } catch (error) {
    try {
      await cleanupRecoveryFixture(fixture);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "test fixture setup and exact cleanup failed; recovery evidence was retained",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

async function loadRecoverySourceBundle(): Promise<RecoverySourceBundle> {
  const [contract, lifecycle, state, start, dispose, runtime, disposeOwnership, startOwnership] =
    await Promise.all([
      readFile(new URL("../cli/live-demo-database-contract.ts", import.meta.url), "utf8"),
      readFile(new URL("../cli/live-demo-database-lifecycle.ts", import.meta.url), "utf8"),
      readFile(new URL("../cli/live-demo-database-state.ts", import.meta.url), "utf8"),
      readFile(new URL("../cli/live-demo-database-start.ts", import.meta.url), "utf8"),
      readFile(new URL("../cli/live-demo-database-dispose.ts", import.meta.url), "utf8"),
      readFile(new URL("./live-demo-database-operator-runtime.ts", import.meta.url), "utf8"),
      readFile(new URL("./live-demo-database-dispose-ownership.ts", import.meta.url), "utf8"),
      readFile(new URL("./live-demo-database-start-ownership.ts", import.meta.url), "utf8"),
    ]);
  return Object.freeze({
    contract,
    lifecycle,
    state,
    start,
    dispose,
    runtime,
    disposeOwnership,
    startOwnership,
  });
}

const recoverySourceSha256 = Object.freeze({
  contract: "7cf66cef847a665b21318c0b54452aa10e213de0d9395ee7fb4a45adf5ee671a",
  lifecycle: "fafc02765a8a139db5ca3c5e7bb88faee793044e53a3604f9e04a6cc1a5c3472",
  state: "1896385ca736075af61af9ccb3a7796943b65734149591a39c96632a308f3793",
  start: "af4fc1f4a808085569f18391825461879de7312561773b8d870969501ec0b0e4",
  dispose: "59e7fa658f51efb86c75d9d38bd6bc2814cfa7983db91c6deb131b39a37433a5",
  runtime: "1e6985b973cde9e6270e1b99caca8f863a1f147674dced0c5ed52a18db6cf8cd",
  disposeOwnership: "120c56d04650a356f64c2c01f362324ce8a75a731d59a7ebbdc28f12abc8b672",
  startOwnership: "bf1fe71170105f602269117c7d0a44729c2e5221cf7b027dad3206fe1646f123",
});

function capabilityFindingsFromViolations(violations: readonly string[]): ProviderActivity {
  const providerConstructions = violations.filter((violation) =>
    violation.endsWith(":provider_or_database_capability"),
  ).length;
  const externalDisposeCodes = new Set([
    "builtin_module_acquisition",
    "environment_capability",
    "filesystem_capability",
    "network_capability",
    "fetch_capability",
    "child_process_capability",
    "listener_capability",
  ]);
  const externalCalls = violations.filter((violation) =>
    externalDisposeCodes.has(violation.slice(violation.lastIndexOf(":") + 1)),
  ).length;
  const calls = violations.filter(
    (violation) =>
      violation.endsWith(":external_mutation_capability") ||
      violation.endsWith(":retry_or_redial_capability"),
  ).length;
  return Object.freeze({ providerConstructions, externalCalls, calls });
}

function inspectRecoveryStructuralIsolation(
  sources: RecoverySourceBundle,
): RecoveryStructuralIsolationEvidence {
  const result = inspectProviderFreeSourceIsolation({
    modules: [
      {
        id: "contract",
        source: sources.contract,
        allowedSourceSha256: recoverySourceSha256.contract,
        allowedStaticImports: ["node:path"],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "lifecycle",
        source: sources.lifecycle,
        allowedSourceSha256: recoverySourceSha256.lifecycle,
        allowedStaticImports: ["./live-demo-database-contract.js", "./live-demo-database-state.js"],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "state",
        source: sources.state,
        allowedSourceSha256: recoverySourceSha256.state,
        allowedStaticImports: [],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "start",
        source: sources.start,
        allowedSourceSha256: recoverySourceSha256.start,
        allowedStaticImports: [
          "./live-demo-database-contract.js",
          "./live-demo-database-lifecycle.js",
          "./live-demo-database-state.js",
          "node:crypto",
          "node:path",
          "node:process",
          "node:url",
        ],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "dispose",
        source: sources.dispose,
        allowedSourceSha256: recoverySourceSha256.dispose,
        allowedStaticImports: [
          "./live-demo-database-contract.js",
          "./live-demo-database-lifecycle.js",
          "./live-demo-database-start.js",
          "./live-demo-database-state.js",
          "node:path",
        ],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "operator-runtime",
        source: sources.runtime,
        allowedSourceSha256: recoverySourceSha256.runtime,
        allowedStaticImports: [
          "../cli/live-demo-database-contract.js",
          "../cli/live-demo-database-dispose.js",
          "../cli/live-demo-database-lifecycle.js",
          "../cli/live-demo-database-start.js",
          "./live-demo-database-dispose-ownership.js",
          "./live-demo-database-start-ownership.js",
          "node:child_process",
          "node:crypto",
          "node:fs/promises",
          "node:path",
          "node:process",
        ],
        allowedDynamicImports: [],
        allowedLocalCapabilityImports: ["node:child_process", "node:fs/promises"],
        allowedLocalCapabilityOccurrences: {
          child_process_capability: 2,
          filesystem_capability: 2,
        },
        allowedEnvironmentVariableReads: [
          "COMSPEC",
          "PATH",
          "PATHEXT",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "SYSTEMROOT",
          "TEMP",
          "TMP",
          "WINDIR",
          "WINDIR",
        ],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "dispose-ownership",
        source: sources.disposeOwnership,
        allowedSourceSha256: recoverySourceSha256.disposeOwnership,
        allowedStaticImports: [
          "../cli/live-demo-database-dispose.js",
          "@muster/infrastructure-postgres",
        ],
        allowedDynamicImports: [],
        allowedLocalCapabilityImports: ["@muster/infrastructure-postgres"],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
      {
        id: "start-ownership",
        source: sources.startOwnership,
        allowedSourceSha256: recoverySourceSha256.startOwnership,
        allowedStaticImports: [
          "../cli/live-demo-database-start.js",
          "@muster/infrastructure-postgres",
        ],
        allowedDynamicImports: [],
        allowedLocalCapabilityImports: ["@muster/infrastructure-postgres"],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
    ],
  });
  const violations = Object.freeze(
    result.violations.map((violation) => `${violation.moduleId}:${violation.code}`),
  );
  return Object.freeze({
    outcome: result.outcome,
    auditedModules: Object.freeze([
      "contract",
      "lifecycle",
      "state",
      "start",
      "dispose",
      "operator-runtime",
      "dispose-ownership",
      "start-ownership",
    ]),
    violations,
    capabilityFindings: capabilityFindingsFromViolations(violations),
  });
}

async function expectRecoveryStructuralIsolationSensitivity(): Promise<void> {
  const sources = await loadRecoverySourceBundle();
  for (const control of [
    {
      name: "provider construction",
      mutation: "new CalleClient();",
      code: "provider_or_database_capability",
    },
    {
      name: "external access",
      mutation: 'fetch("https://forbidden.invalid");',
      code: "fetch_capability",
    },
    {
      name: "captured external access",
      mutation: "const capturedFetch = globalThis.fetch; void capturedFetch;",
      code: "fetch_capability",
    },
    {
      name: "call creation",
      mutation: "provider.createCall();",
      code: "external_mutation_capability",
    },
    {
      name: "call dialing",
      mutation: "provider.dial();",
      code: "external_mutation_capability",
    },
    {
      name: "credential environment read",
      mutation: 'process.env["CALLE_API_KEY"];',
      code: "environment_capability",
    },
    {
      name: "dynamic environment read",
      mutation: "process.env[name];",
      code: "environment_capability",
    },
    {
      name: "CommonJS provider load",
      mutation: 'requireFromRepositoryRoot("twilio");',
      code: "builtin_module_acquisition",
    },
    {
      name: "process builtin createRequire provider load",
      mutation:
        'const runtimeProcess = process; const moduleBuiltin = runtimeProcess.getBuiltinModule("module"); const loader = moduleBuiltin["createRequire"](import.meta.url); void loader("twilio");',
      code: "builtin_module_acquisition",
    },
    {
      name: "process builtin internal CommonJS provider load",
      mutation: 'const Module = (process).getBuiltinModule("module"); void Module._load("twilio");',
      code: "builtin_module_acquisition",
    },
    {
      name: "reflected process builtin CommonJS provider load",
      mutation:
        'const acquire = Reflect["get"](process, "getBuiltinModule"); const Module = acquire("module"); void Reflect["get"](Module, "_load")("twilio");',
      code: "builtin_module_acquisition",
    },
    {
      name: "captured reflection CommonJS provider load",
      mutation:
        'const reflectedGet = Reflect.get; const acquire = reflectedGet(process, "getBuiltinModule"); const Module = acquire("module"); const load = reflectedGet(Module, "_load"); void load("twilio");',
      code: "builtin_module_acquisition",
    },
    {
      name: "indirect eval provider load",
      mutation:
        'const run = (0, eval); run(\'process.getBuiltinModule("module")._load("twilio")\');',
      code: "builtin_module_acquisition",
    },
    {
      name: "global eval credential read",
      mutation: 'const run = globalThis["eval"]; run(\'process.env["CALLE_API_KEY"]\');',
      code: "builtin_module_acquisition",
    },
    {
      name: "aliased Function credential read",
      mutation:
        "const DynamicFunction = Function; new DynamicFunction('return process.env[\"CALLE_API_KEY\"]')();",
      code: "builtin_module_acquisition",
    },
  ] as const) {
    const result = inspectProviderFreeSourceIsolation({
      modules: [
        {
          id: "dispose",
          source: `${sources.dispose}\n${control.mutation}\n`,
          allowedSourceSha256: recoverySourceSha256.dispose,
          allowedStaticImports: [
            "./live-demo-database-contract.js",
            "./live-demo-database-lifecycle.js",
            "./live-demo-database-start.js",
            "./live-demo-database-state.js",
            "node:path",
          ],
          allowedDynamicImports: [],
          allowedEnvironmentVariableReads: [],
          enforceExactBuiltinModuleBoundary: true,
        },
      ],
    });
    expect(result.outcome, control.name).toBe("BLOCKED");
    expect(result.violations, control.name).toContainEqual({
      moduleId: "dispose",
      code: control.code,
    });
  }

  const namedBuiltinImport = inspectProviderFreeSourceIsolation({
    modules: [
      {
        id: "start",
        source: `${sources.start.replace(
          'import process from "node:process";',
          'import process, { getBuiltinModule as acquireBuiltin } from "node:process";',
        )}\nconst { _load: loadModule } = acquireBuiltin("module"); loadModule("twilio");\n`,
        allowedSourceSha256: recoverySourceSha256.start,
        allowedStaticImports: [
          "./live-demo-database-contract.js",
          "./live-demo-database-lifecycle.js",
          "./live-demo-database-state.js",
          "node:crypto",
          "node:path",
          "node:process",
          "node:url",
        ],
        allowedDynamicImports: [],
        allowedEnvironmentVariableReads: [],
        enforceExactBuiltinModuleBoundary: true,
      },
    ],
  });
  expect(namedBuiltinImport.outcome).toBe("BLOCKED");
  expect(namedBuiltinImport.violations).toContainEqual({
    moduleId: "start",
    code: "builtin_module_acquisition",
  });

  const crlfStateSource = sources.state.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\r\n");
  expect(
    inspectProviderFreeSourceIsolation({
      modules: [
        {
          id: "state",
          source: crlfStateSource,
          allowedSourceSha256: recoverySourceSha256.state,
          allowedStaticImports: [],
          allowedDynamicImports: [],
          allowedEnvironmentVariableReads: [],
          enforceExactBuiltinModuleBoundary: true,
        },
      ],
    }),
  ).toEqual({ outcome: "PASS", violations: [] });
  expect(
    inspectProviderFreeSourceIsolation({
      modules: [
        {
          id: "state",
          source: `${sources.state}\nvoid 0;\n`,
          allowedSourceSha256: recoverySourceSha256.state,
          allowedStaticImports: [],
          allowedDynamicImports: [],
          allowedEnvironmentVariableReads: [],
          enforceExactBuiltinModuleBoundary: true,
        },
      ],
    }).violations,
  ).toContainEqual({ moduleId: "state", code: "source_integrity" });

  for (const control of [
    {
      name: "extra subprocess",
      source: `${sources.runtime}\nspawn("forbidden", []);\n`,
      expectedCode: "child_process_capability",
    },
    {
      name: "Twilio import",
      source: `${sources.runtime}\nimport { Twilio } from "twilio";\n`,
      expectedCode: "forbidden_import",
    },
    {
      name: "parameter-destructured environment escape",
      source: `${sources.runtime}\nfunction readCredential({ env }: typeof process) { return env.CALLE_API_KEY; } void readCredential(process);\n`,
      expectedCode: "environment_capability",
    },
    {
      name: "returned environment escape",
      source: `${sources.runtime}\nfunction pluckEnvironment(value: typeof process) { const { env } = value; return env; } const stolen = pluckEnvironment(process); void stolen.CALLE_API_KEY;\n`,
      expectedCode: "environment_capability",
    },
    {
      name: "computed reflected environment escape",
      source: `${sources.runtime}\nconst reflectedEnvironment = Reflect["get"](process, "env"); void Reflect["get"](reflectedEnvironment, "CALLE_API_KEY");\n`,
      expectedCode: "environment_capability",
    },
    {
      name: "captured reflected environment escape",
      source: `${sources.runtime}\nconst reflectedGet = Reflect.get; const reflectedEnvironment = reflectedGet(process, "env"); void reflectedGet(reflectedEnvironment, "CALLE_API_KEY");\n`,
      expectedCode: "environment_capability",
    },
    {
      name: "captured descriptor environment escape",
      source: `${sources.runtime}\nconst reflectedDescriptor = Object.getOwnPropertyDescriptor; const reflectedEnvironment = reflectedDescriptor(process, "env")?.value; void reflectedEnvironment?.CALLE_API_KEY;\n`,
      expectedCode: "environment_capability",
    },
  ] as const) {
    const result = inspectProviderFreeSourceIsolation({
      modules: [
        {
          id: "operator-runtime",
          source: control.source,
          allowedSourceSha256: recoverySourceSha256.runtime,
          allowedStaticImports: [
            "../cli/live-demo-database-contract.js",
            "../cli/live-demo-database-dispose.js",
            "../cli/live-demo-database-lifecycle.js",
            "../cli/live-demo-database-start.js",
            "./live-demo-database-dispose-ownership.js",
            "./live-demo-database-start-ownership.js",
            "node:child_process",
            "node:crypto",
            "node:fs/promises",
            "node:path",
            "node:process",
          ],
          allowedDynamicImports: [],
          allowedLocalCapabilityImports: ["node:child_process", "node:fs/promises"],
          allowedLocalCapabilityOccurrences: {
            child_process_capability: 2,
            filesystem_capability: 2,
          },
          allowedEnvironmentVariableReads: [
            "COMSPEC",
            "PATH",
            "PATHEXT",
            "SYSTEMDRIVE",
            "SYSTEMROOT",
            "SYSTEMROOT",
            "TEMP",
            "TMP",
            "WINDIR",
            "WINDIR",
          ],
          enforceExactBuiltinModuleBoundary: true,
        },
      ],
    });
    expect(result.outcome, control.name).toBe("BLOCKED");
    expect(result.violations, control.name).toContainEqual({
      moduleId: "operator-runtime",
      code: control.expectedCode,
    });
  }
}

const expectedRecoverySequences: Readonly<
  Record<RecoveryScenario, readonly RecoveryProcessKind[]>
> = Object.freeze({
  stable_absence: Object.freeze([
    "name_snapshot",
    "session_snapshot",
    "name_snapshot",
    "session_snapshot",
    "name_snapshot",
    "session_snapshot",
  ]),
  exact_candidate: Object.freeze([
    "name_snapshot",
    "session_snapshot",
    "name_snapshot",
    "session_snapshot",
    "strict_inspect",
    "strict_inspect",
    "strict_inspect",
    "exact_remove",
    "id_absence",
  ]),
});

function expectedRecoveryArguments(
  fixture: RecoveryFixture,
  kind: RecoveryProcessKind,
): readonly string[] | undefined {
  if (kind === "name_snapshot") {
    return Object.freeze([
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `name=^/${fixture.containerName}$`,
      "--format",
      "{{.ID}}",
    ]);
  }
  if (kind === "session_snapshot") {
    return Object.freeze([
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `label=com.muster.live-demo-database.session=${fixture.sessionId}`,
      "--format",
      "{{.ID}}",
    ]);
  }
  if (fixture.containerId === undefined) return undefined;
  if (kind === "strict_inspect") {
    return Object.freeze([
      "inspect",
      "--type",
      "container",
      "--format",
      safeCleanupInspectFormat,
      fixture.containerId,
    ]);
  }
  if (kind === "exact_remove") {
    return Object.freeze(["rm", "--force", fixture.containerId]);
  }
  return Object.freeze([
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    `id=${fixture.containerId}`,
    "--format",
    "{{.ID}}",
  ]);
}

function isExactRecoveryProcessRequest(
  request: LiveDemoDatabaseProcessRequest,
  fixture: RecoveryFixture,
  kind: RecoveryProcessKind,
): boolean {
  const expectedArguments = expectedRecoveryArguments(fixture, kind);
  const expectedTimeout =
    kind === "strict_inspect" ? recoveryInspectTimeoutMs : recoveryProcessTimeoutMs;
  return (
    expectedArguments !== undefined &&
    hasExactKeys(request as unknown as Record<string, unknown>, [
      "executable",
      "arguments",
      "cwd",
      "environment",
      "timeoutMs",
      "output",
    ]) &&
    request.executable === "docker" &&
    request.arguments.length === expectedArguments.length &&
    request.arguments.every((argument, index) => argument === expectedArguments[index]) &&
    request.cwd === fixture.repositoryRoot &&
    isRecord(request.environment) &&
    hasExactKeys(request.environment, []) &&
    request.timeoutMs === expectedTimeout &&
    request.output === "capture_suppressed"
  );
}

function createRecoveryIsolationMembrane(input: {
  readonly baseCapabilities: LiveDemoDatabaseDisposeCapabilities;
  readonly fixture: RecoveryFixture;
  readonly scenario: RecoveryScenario;
  readonly structuralIsolation: RecoveryStructuralIsolationEvidence;
  readonly observeAllowedProcess: (request: LiveDemoDatabaseProcessRequest) => Promise<void>;
}): RecoveryIsolationMembrane {
  const expectedSequence = expectedRecoverySequences[input.scenario];
  const observedKinds: RecoveryProcessKind[] = [];
  let rejectedRequests = 0;
  const capabilities: LiveDemoDatabaseDisposeCapabilities = Object.freeze({
    ...input.baseCapabilities,
    process: Object.freeze({
      run: async (request) => {
        const expectedKind = expectedSequence[observedKinds.length];
        if (
          expectedKind === undefined ||
          !isExactRecoveryProcessRequest(request, input.fixture, expectedKind)
        ) {
          rejectedRequests += 1;
          throw new Error(recoveryBoundaryError);
        }
        await input.observeAllowedProcess(request);
        observedKinds.push(expectedKind);
        return await input.baseCapabilities.process.run(request);
      },
    }),
  });
  return Object.freeze({
    capabilities,
    report: () => {
      const processBoundaryOutcome =
        rejectedRequests === 0 && observedKinds.length === expectedSequence.length
          ? "PASS"
          : "BLOCKED";
      const capabilityBudget = Object.freeze({
        providerConstructions: input.structuralIsolation.capabilityFindings.providerConstructions,
        externalCalls:
          input.structuralIsolation.capabilityFindings.externalCalls + rejectedRequests,
        calls: input.structuralIsolation.capabilityFindings.calls,
      });
      const outcome =
        input.structuralIsolation.outcome === "PASS" && processBoundaryOutcome === "PASS"
          ? "PASS"
          : "BLOCKED";
      return Object.freeze({
        outcome,
        structuralIsolation: input.structuralIsolation,
        processBoundary: Object.freeze({
          outcome: processBoundaryOutcome,
          observedKinds: Object.freeze([...observedKinds]),
          rejectedRequests,
        }),
        capabilityBudget,
      });
    },
  });
}

function exactRecoveryRequest(
  fixture: RecoveryFixture,
  arguments_: readonly string[],
  timeoutMs: number,
): LiveDemoDatabaseProcessRequest {
  return Object.freeze({
    executable: "docker",
    arguments: Object.freeze([...arguments_]),
    cwd: fixture.repositoryRoot,
    environment: Object.freeze({}),
    timeoutMs,
    output: "capture_suppressed" as const,
  });
}

function exactExpectedRecoveryRequest(
  fixture: RecoveryFixture,
  kind: RecoveryProcessKind,
): LiveDemoDatabaseProcessRequest {
  const arguments_ = expectedRecoveryArguments(fixture, kind);
  if (arguments_ === undefined) {
    throw new Error("test-owned Docker identity was unavailable");
  }
  return exactRecoveryRequest(
    fixture,
    arguments_,
    kind === "strict_inspect" ? recoveryInspectTimeoutMs : recoveryProcessTimeoutMs,
  );
}

async function expectRecoveryProcessBoundarySensitivity(fixture: RecoveryFixture): Promise<void> {
  const structuralIsolation = inspectRecoveryStructuralIsolation(await loadRecoverySourceBundle());
  const createProbe = (): Readonly<{
    membrane: RecoveryIsolationMembrane;
    forwardedRequests: () => number;
  }> => {
    let forwardedRequests = 0;
    const baseCapabilities: LiveDemoDatabaseDisposeCapabilities = {
      ...fixture.runtime.dispose,
      process: {
        run: async () => {
          forwardedRequests += 1;
          return Object.freeze({ exitCode: 0, stdout: "" });
        },
      },
    };
    return Object.freeze({
      membrane: createRecoveryIsolationMembrane({
        baseCapabilities,
        fixture,
        scenario: "exact_candidate",
        structuralIsolation,
        observeAllowedProcess: async () => undefined,
      }),
      forwardedRequests: () => forwardedRequests,
    });
  };

  const subprocessProbe = createProbe();
  await expect(
    subprocessProbe.membrane.capabilities.process.run({
      ...exactExpectedRecoveryRequest(fixture, "name_snapshot"),
      executable: "node",
    }),
  ).rejects.toThrow(recoveryBoundaryError);
  expect(subprocessProbe.forwardedRequests()).toBe(0);
  expect(subprocessProbe.membrane.report()).toMatchObject({
    outcome: "BLOCKED",
    processBoundary: { rejectedRequests: 1 },
    capabilityBudget: { providerConstructions: 0, externalCalls: 1, calls: 0 },
  });

  const removalProbe = createProbe();
  const preRemovalKinds = expectedRecoverySequences.exact_candidate.slice(
    0,
    expectedRecoverySequences.exact_candidate.indexOf("exact_remove"),
  );
  for (const kind of preRemovalKinds) {
    await removalProbe.membrane.capabilities.process.run(
      exactExpectedRecoveryRequest(fixture, kind),
    );
  }
  const forwardedBeforeRejectedRemoval = removalProbe.forwardedRequests();
  const containerId = fixture.containerId;
  if (containerId === undefined) throw new Error("test-owned Docker identity was unavailable");
  await expect(
    removalProbe.membrane.capabilities.process.run(
      exactRecoveryRequest(
        fixture,
        ["rm", "--force", containerId, "unowned-extra-target"],
        recoveryProcessTimeoutMs,
      ),
    ),
  ).rejects.toThrow(recoveryBoundaryError);
  expect(removalProbe.forwardedRequests()).toBe(forwardedBeforeRejectedRemoval);
  expect(removalProbe.membrane.report()).toMatchObject({
    outcome: "BLOCKED",
    processBoundary: { rejectedRequests: 1 },
    capabilityBudget: { providerConstructions: 0, externalCalls: 1, calls: 0 },
  });
}

async function observeDisposal(
  fixture: RecoveryFixture,
  scenario: RecoveryScenario,
): Promise<ObservedDisposal> {
  const requests: LiveDemoDatabaseProcessRequest[] = [];
  const waitDurations: number[] = [];
  let stateBeforeRemove: LiveDemoDatabaseLifecycleState | undefined;
  const structuralIsolation = inspectRecoveryStructuralIsolation(await loadRecoverySourceBundle());
  const baseCapabilities: LiveDemoDatabaseDisposeCapabilities = {
    ...fixture.runtime.dispose,
    wait: async (milliseconds) => {
      waitDurations.push(milliseconds);
      await fixture.runtime.dispose.wait(milliseconds);
    },
  };
  const membrane = createRecoveryIsolationMembrane({
    baseCapabilities,
    fixture,
    scenario,
    structuralIsolation,
    observeAllowedProcess: async (request) => {
      requests.push(request);
      if (request.arguments[0] === "rm") {
        stateBeforeRemove = parseLiveDemoDatabaseLifecycleState(
          JSON.parse(await readFile(fixture.paths.lifecycleState, "utf8")),
        );
      }
    },
  });
  return Object.freeze({
    capabilities: membrane.capabilities,
    requests,
    waitDurations,
    stateObservedBeforeRemove: () => stateBeforeRemove,
    isolationEvidence: membrane.report,
  });
}

async function createStoppedExactContainer(fixture: RecoveryFixture): Promise<readonly string[]> {
  const createArguments = Object.freeze([
    "create",
    "--name",
    fixture.containerName,
    "--label-file",
    path.join(fixture.paths.root, "container-labels.tmp"),
    "--publish",
    `127.0.0.1:${fixture.hostPort}:5432`,
    "--tmpfs",
    tmpfsSpecification,
    "--env",
    "POSTGRES_USER",
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    "POSTGRES_DB",
    LIVE_DEMO_DATABASE_PINNED_IMAGE,
  ]);
  const created = await fixture.runtime.start.process.run(
    dockerRequest(fixture, createArguments, {
      POSTGRES_USER: "muster_recovery_test",
      POSTGRES_PASSWORD: randomBytes(24).toString("base64url"),
      POSTGRES_DB: "muster_recovery_test",
    }),
  );
  const containerId = created.stdout.trim();
  if (created.exitCode !== 0 || !containerIdPattern.test(containerId)) {
    throw new Error("test-owned stopped Docker container could not be created");
  }
  fixture.containerId = containerId;
  return createArguments;
}

describe.skipIf(!enabled)("live-demo database operator runtime", () => {
  it("recovers an unavailable CID only after stable real-Docker absence", async () => {
    const fixture = await createRecoveryFixture();
    try {
      await expectRecoveryStructuralIsolationSensitivity();
      const observed = await observeDisposal(fixture, "stable_absence");
      expect((await stat(path.join(fixture.paths.root, "container.cid"))).size).toBe(0);

      await expect(
        disposeLiveDemoDatabase({
          repositoryRoot: fixture.repositoryRoot,
          capabilities: observed.capabilities,
        }),
      ).resolves.toMatchObject({ outcome: "disposed" });

      const nameSelector = `name=^/${fixture.containerName}$`;
      const sessionSelector = `label=com.muster.live-demo-database.session=${fixture.sessionId}`;
      expect(observed.waitDurations).toEqual([10_000]);
      expect(
        observed.requests.filter((request) => request.arguments.includes(nameSelector)),
      ).toHaveLength(3);
      expect(
        observed.requests.filter((request) => request.arguments.includes(sessionSelector)),
      ).toHaveLength(3);
      expect(
        observed.requests.some(
          (request) => request.arguments[0] === "inspect" || request.arguments[0] === "rm",
        ),
      ).toBe(false);
      expect(
        observed.requests.every((request) =>
          request.arguments.every((argument) => !argument.includes(fixture.ownershipToken)),
        ),
      ).toBe(true);
      await expect(readdir(fixture.paths.root)).resolves.toEqual([]);
      expect(observed.isolationEvidence()).toEqual({
        outcome: "PASS",
        structuralIsolation: {
          outcome: "PASS",
          auditedModules: [
            "contract",
            "lifecycle",
            "state",
            "start",
            "dispose",
            "operator-runtime",
            "dispose-ownership",
            "start-ownership",
          ],
          violations: [],
          capabilityFindings: { providerConstructions: 0, externalCalls: 0, calls: 0 },
        },
        processBoundary: {
          outcome: "PASS",
          observedKinds: expectedRecoverySequences.stable_absence,
          rejectedRequests: 0,
        },
        capabilityBudget: { providerConstructions: 0, externalCalls: 0, calls: 0 },
      });
    } finally {
      await cleanupRecoveryFixture(fixture);
    }
  }, 90_000);

  it("adopts exact real-Docker proof before removing a stopped lost-CID container", async () => {
    const fixture = await createRecoveryFixture();
    try {
      const createArguments = await createStoppedExactContainer(fixture);
      expect(createArguments.every((argument) => !argument.includes(fixture.ownershipToken))).toBe(
        true,
      );
      expect((await stat(path.join(fixture.paths.root, "container.cid"))).size).toBe(0);

      await expectRecoveryProcessBoundarySensitivity(fixture);
      const observed = await observeDisposal(fixture, "exact_candidate");
      await expect(
        disposeLiveDemoDatabase({
          repositoryRoot: fixture.repositoryRoot,
          capabilities: observed.capabilities,
        }),
      ).resolves.toMatchObject({ outcome: "disposed" });

      const nameSelector = `name=^/${fixture.containerName}$`;
      const sessionSelector = `label=com.muster.live-demo-database.session=${fixture.sessionId}`;
      expect(observed.waitDurations).toEqual([10_000]);
      expect(
        observed.requests.filter((request) => request.arguments.includes(nameSelector)),
      ).toHaveLength(2);
      expect(
        observed.requests.filter((request) => request.arguments.includes(sessionSelector)),
      ).toHaveLength(2);
      expect(observed.requests.filter((request) => request.arguments[0] === "rm")).toHaveLength(1);
      expect(
        observed.requests.every((request) =>
          request.arguments.every((argument) => !argument.includes(fixture.ownershipToken)),
        ),
      ).toBe(true);

      const stateBeforeRemove = observed.stateObservedBeforeRemove();
      expect(stateBeforeRemove?.status).toBe("disposing");
      expect(stateBeforeRemove?.checkpoint).toBe("container_created");
      expect(stateBeforeRemove?.container?.id).toBe(fixture.containerId);
      await expect(queryExactIds(fixture, `id=${fixture.containerId}`)).resolves.toEqual([]);
      await expect(queryExactIds(fixture, nameSelector)).resolves.toEqual([]);
      await expect(queryExactIds(fixture, sessionSelector)).resolves.toEqual([]);
      await expect(readdir(fixture.paths.root)).resolves.toEqual([]);
      expect(observed.isolationEvidence()).toMatchObject({
        outcome: "PASS",
        structuralIsolation: {
          outcome: "PASS",
          auditedModules: [
            "contract",
            "lifecycle",
            "state",
            "start",
            "dispose",
            "operator-runtime",
            "dispose-ownership",
            "start-ownership",
          ],
          violations: [],
          capabilityFindings: { providerConstructions: 0, externalCalls: 0, calls: 0 },
        },
        processBoundary: {
          outcome: "PASS",
          observedKinds: expectedRecoverySequences.exact_candidate,
          rejectedRequests: 0,
        },
        capabilityBudget: { providerConstructions: 0, externalCalls: 0, calls: 0 },
      });
    } finally {
      await cleanupRecoveryFixture(fixture);
    }
  }, 90_000);

  it("starts, activates, verifies provider-free ownership and migrations, then disposes", async () => {
    const paths = createLiveDemoDatabasePaths(repositoryRoot);
    const runtime = createLiveDemoDatabaseOperatorRuntime(repositoryRoot);
    try {
      const start = await startLiveDemoDatabase({ repositoryRoot, capabilities: runtime.start });
      expect(start).toMatchObject({ outcome: "ready", activationScript: paths.activationScript });

      const [databaseUrlFile, attestationFile, activationScript] = await Promise.all([
        readFile(paths.databaseUrl, "utf8"),
        readFile(paths.provisioningAttestation, "utf8"),
        readFile(paths.activationScript, "utf8"),
      ]);
      const databaseUrl = databaseUrlFile.trim();
      const attestation = JSON.parse(attestationFile) as unknown;
      const activationLines = activationScript.trimEnd().split("\n");
      const activationHasExactShape =
        activationLines.length === 3 &&
        activationLines[0]?.startsWith("$env:DATABASE_URL = '") === true &&
        activationLines[1]?.startsWith("$env:MIGRATION_DATABASE_URL = '") === true &&
        activationLines[2] ===
          `$env:LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE = '${paths.provisioningAttestation.replaceAll("'", "''")}'`;
      expect(activationHasExactShape).toBe(true);

      const owner = runtime.start.ownership.createDisposablePostgresOwner(databaseUrl, {
        loadProvisioningAttestation: async () => attestation,
      });
      await expect(owner.attestOwnership()).resolves.toMatchObject({
        outcome: "owned",
        exclusive: true,
      });

      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      try {
        const migration = await pool.query<{ migration_count: string }>(
          'SELECT COUNT(*)::text AS migration_count FROM "_prisma_migrations"',
        );
        expect(Number(migration.rows[0]?.migration_count)).toBeGreaterThan(0);
      } finally {
        await pool.end();
      }

      const previous = {
        databaseUrl: process.env["DATABASE_URL"],
        migrationDatabaseUrl: process.env["MIGRATION_DATABASE_URL"],
        attestation: process.env["LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE"],
      };
      process.env["DATABASE_URL"] = databaseUrl;
      process.env["MIGRATION_DATABASE_URL"] = databaseUrl;
      process.env["LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE"] = paths.provisioningAttestation;
      try {
        await expect(runProviderFreePrepareVerification()).resolves.toMatchObject({
          outcome: "PASS",
          evidenceClass: "LOCAL_PROVIDER_FREE",
          authorizesCall: false,
          runGate: "CLOSED",
          capabilityBudget: { providerConstructions: 0, externalCalls: 0, calls: 0 },
        });
      } finally {
        for (const [name, value] of [
          ["DATABASE_URL", previous.databaseUrl],
          ["MIGRATION_DATABASE_URL", previous.migrationDatabaseUrl],
          ["LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE", previous.attestation],
        ] as const) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }

      await expect(
        disposeLiveDemoDatabase({ repositoryRoot, capabilities: runtime.dispose }),
      ).resolves.toMatchObject({ outcome: "disposed" });
      await expect(pathExists(paths.lifecycleState)).resolves.toBe(false);
      await expect(pathExists(paths.databaseUrl)).resolves.toBe(false);
      await expect(pathExists(paths.provisioningAttestation)).resolves.toBe(false);
      await expect(pathExists(paths.activationScript)).resolves.toBe(false);
    } finally {
      if (await pathExists(paths.lifecycleState)) {
        await disposeLiveDemoDatabase({ repositoryRoot, capabilities: runtime.dispose });
      }
      const residual = await runtime.dispose.process.run({
        executable: "docker",
        arguments: [
          "ps",
          "--all",
          "--no-trunc",
          "--filter",
          "label=com.muster.live-demo-database.session",
          "--format",
          "{{.ID}}",
        ],
        cwd: repositoryRoot,
        environment: {},
        timeoutMs: 10_000,
        output: "capture_suppressed",
      });
      expect({ exitCode: residual.exitCode, empty: residual.stdout.trim() === "" }).toEqual({
        exitCode: 0,
        empty: true,
      });
    }
  }, 180_000);
});

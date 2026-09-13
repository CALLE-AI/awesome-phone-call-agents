import path from "node:path";

import {
  createLiveDemoDatabasePaths,
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
  LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
} from "./live-demo-database-contract.js";
import {
  persistLiveDemoDatabaseLifecycleTransition,
  type LiveDemoDatabaseStatePublication,
} from "./live-demo-database-lifecycle.js";
import {
  parseLiveDemoDatabaseLifecycleState,
  serializeLiveDemoDatabaseLifecycleState,
  transitionLiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseContainerProof,
  type LiveDemoDatabaseLifecycleState,
} from "./live-demo-database-state.js";
import type {
  LiveDemoDatabaseOwnershipAttestation,
  LiveDemoDatabaseProcessRequest,
  LiveDemoDatabaseProcessResult,
} from "./live-demo-database-start.js";

const dockerExecutable = "docker";
const shortProcessTimeoutMs = 10_000;
const inspectTimeoutMs = 2_000;
const protectedFileCleanupTimeoutMs = 2_000;
const ambiguousCreateQuiescenceMs = 10_000;
const maximumStateBytes = 16 * 1024;
const maximumDatabaseUrlBytes = 4 * 1024;
const maximumAttestationBytes = 8 * 1024;
const maximumRecoveryMaterialBytes = 16 * 1024;
const tmpfsValue = "rw,noexec,nosuid,nodev,size=536870912";
const safeInspectFormat =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"HostConfig":{"Binds":{{json .HostConfig.Binds}},"PortBindings":{{json .HostConfig.PortBindings}},"Tmpfs":{{json .HostConfig.Tmpfs}}},"Mounts":{{json .Mounts}}}';
const digestPattern = /^[0-9a-f]{64}$/u;
const ownershipTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const decimalIdentifierPattern = /^[1-9][0-9]{0,31}$/u;

export interface LiveDemoDatabaseDisposeOwnershipCapabilities {
  createDisposablePostgresOwner(
    connectionString: string,
    input: Readonly<{ loadProvisioningAttestation: () => Promise<unknown> }>,
  ): Readonly<{
    attestOwnership(): Promise<LiveDemoDatabaseOwnershipAttestation>;
    teardown(input: {
      readonly closeConnections: () => Promise<void>;
      readonly expectedProvisioningOwnershipDigest: string;
    }): Promise<Readonly<{ outcome: "deleted" }>>;
    verifyDeleted(input: {
      readonly expectedProvisioningOwnershipDigest: string;
    }): Promise<boolean>;
  }>;
}

export interface LiveDemoDatabaseDisposeCapabilities {
  readonly process: {
    run(request: LiveDemoDatabaseProcessRequest): Promise<LiveDemoDatabaseProcessResult>;
  };
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly state: LiveDemoDatabaseStatePublication & {
    loadOwnerOnly(maximumBytes: number): Promise<string | undefined>;
    removeExact(expectedSerializedState: string): Promise<boolean>;
  };
  readonly artifacts: {
    verifyOwnerOnly(filePath: string): Promise<boolean>;
    readOwnerOnly(filePath: string, maximumBytes: number): Promise<string | undefined>;
    removeWithin(filePath: string, timeoutMs: number): Promise<boolean>;
  };
  readonly ownership: LiveDemoDatabaseDisposeOwnershipCapabilities;
  readonly closeConnections: () => Promise<void>;
}

export type LiveDemoDatabaseDisposeResult =
  | Readonly<{
      outcome: "disposed";
      message: typeof LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE;
    }>
  | Readonly<{
      outcome: "blocked";
      message: typeof LIVE_DEMO_DATABASE_ATTENTION_MESSAGE;
    }>;

interface ProtectedDatabaseMaterial {
  readonly connectionString: string;
  readonly attestation: Readonly<Record<string, unknown>>;
}

function blocked(): LiveDemoDatabaseDisposeResult {
  return Object.freeze({ outcome: "blocked", message: LIVE_DEMO_DATABASE_ATTENTION_MESSAGE });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function dockerRequest(
  repositoryRoot: string,
  arguments_: readonly string[],
  timeoutMs = shortProcessTimeoutMs,
): LiveDemoDatabaseProcessRequest {
  return Object.freeze({
    executable: dockerExecutable,
    arguments: Object.freeze([...arguments_]),
    cwd: repositoryRoot,
    environment: Object.freeze({}),
    timeoutMs,
    output: "capture_suppressed" as const,
  });
}

function exactContainerInspection(
  serialized: string,
  proof: LiveDemoDatabaseContainerProof,
): boolean {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return false;
    const config = value["Config"];
    const hostConfig = value["HostConfig"];
    if (!isRecord(config) || !isRecord(hostConfig)) return false;
    const labels = config["Labels"];
    const binds = hostConfig["Binds"];
    const bindings = hostConfig["PortBindings"];
    const tmpfs = hostConfig["Tmpfs"];
    const mounts = value["Mounts"];
    if (
      !isRecord(labels) ||
      !hasExactKeys(labels, [
        "com.muster.live-demo-database.session",
        "com.muster.live-demo-database.owner",
      ]) ||
      !isRecord(bindings) ||
      !hasExactKeys(bindings, ["5432/tcp"]) ||
      !isRecord(tmpfs) ||
      !hasExactKeys(tmpfs, ["/var/lib/postgresql/data"]) ||
      (binds !== null && (!Array.isArray(binds) || binds.length !== 0)) ||
      !Array.isArray(mounts) ||
      mounts.length !== 0
    ) {
      return false;
    }
    const binding = bindings["5432/tcp"];
    return (
      Array.isArray(binding) &&
      binding.length === 1 &&
      isRecord(binding[0]) &&
      hasExactKeys(binding[0], ["HostIp", "HostPort"]) &&
      value["Id"] === proof.id &&
      value["Name"] === `/${proof.name}` &&
      config["Image"] === proof.image &&
      labels["com.muster.live-demo-database.session"] ===
        proof.labels["com.muster.live-demo-database.session"] &&
      labels["com.muster.live-demo-database.owner"] ===
        proof.labels["com.muster.live-demo-database.owner"] &&
      binding[0]["HostIp"] === proof.binding.host &&
      binding[0]["HostPort"] === String(proof.binding.hostPort) &&
      tmpfs["/var/lib/postgresql/data"] === tmpfsValue
    );
  } catch {
    return false;
  }
}

async function inspectExactContainer(input: {
  readonly repositoryRoot: string;
  readonly proof: LiveDemoDatabaseContainerProof;
  readonly process: LiveDemoDatabaseDisposeCapabilities["process"];
}): Promise<"exact" | "mismatch" | "unavailable"> {
  const result = await input.process.run(
    dockerRequest(
      input.repositoryRoot,
      ["inspect", "--type", "container", "--format", safeInspectFormat, input.proof.id],
      inspectTimeoutMs,
    ),
  );
  if (result.exitCode !== 0) return "unavailable";
  return exactContainerInspection(result.stdout, input.proof) ? "exact" : "mismatch";
}

async function verifyContainerAbsent(input: {
  readonly repositoryRoot: string;
  readonly proof: LiveDemoDatabaseContainerProof;
  readonly process: LiveDemoDatabaseDisposeCapabilities["process"];
}): Promise<boolean> {
  const result = await input.process.run(
    dockerRequest(input.repositoryRoot, [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `id=${input.proof.id}`,
      "--format",
      "{{.ID}}",
    ]),
  );
  return result.exitCode === 0 && result.stdout.trim() === "";
}

interface AmbiguousCreateCandidateSnapshot {
  readonly id: string | null;
}

function parseCanonicalCandidateId(serialized: string): string | null | undefined {
  if (serialized === "") return null;
  const match = /^([0-9a-f]{64})(?:\r?\n)?$/u.exec(serialized);
  return match?.[1];
}

async function queryAmbiguousCreateCandidateSnapshot(input: {
  readonly repositoryRoot: string;
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly process: LiveDemoDatabaseDisposeCapabilities["process"];
}): Promise<AmbiguousCreateCandidateSnapshot | undefined> {
  const nameResult = await input.process.run(
    dockerRequest(input.repositoryRoot, [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `name=^/${input.state.containerIntent.name}$`,
      "--format",
      "{{.ID}}",
    ]),
  );
  if (nameResult.exitCode !== 0) return undefined;
  const nameId = parseCanonicalCandidateId(nameResult.stdout);
  if (nameId === undefined) return undefined;

  const sessionResult = await input.process.run(
    dockerRequest(input.repositoryRoot, [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `label=com.muster.live-demo-database.session=${input.state.session.id}`,
      "--format",
      "{{.ID}}",
    ]),
  );
  if (sessionResult.exitCode !== 0) return undefined;
  const sessionId = parseCanonicalCandidateId(sessionResult.stdout);
  if (sessionId === undefined || sessionId !== nameId) return undefined;
  return Object.freeze({ id: nameId });
}

function parseSingleProtectedLine(serialized: string): string | undefined {
  const value = serialized.endsWith("\n") ? serialized.slice(0, -1) : serialized;
  return value.length > 0 && !/[\0\r\n]/u.test(value) ? value : undefined;
}

function parseExactAttestation(
  serialized: string,
  state: LiveDemoDatabaseLifecycleState,
): Readonly<Record<string, unknown>> | undefined {
  if (state.database === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, [
        "version",
        "databaseName",
        "databaseOid",
        "clusterSystemIdentifier",
        "ownershipToken",
        "exclusive",
      ]) ||
      parsed["version"] !== 1 ||
      parsed["exclusive"] !== true ||
      parsed["databaseName"] !== state.database.databaseName ||
      typeof parsed["databaseOid"] !== "string" ||
      !decimalIdentifierPattern.test(parsed["databaseOid"]) ||
      typeof parsed["clusterSystemIdentifier"] !== "string" ||
      !decimalIdentifierPattern.test(parsed["clusterSystemIdentifier"]) ||
      typeof parsed["ownershipToken"] !== "string" ||
      !ownershipTokenPattern.test(parsed["ownershipToken"])
    ) {
      return undefined;
    }
    return Object.freeze({ ...parsed });
  } catch {
    return undefined;
  }
}

function exactConnectionString(value: string, state: LiveDemoDatabaseLifecycleState): boolean {
  if (state.container === null || state.database === null) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "postgresql:" &&
      url.hostname === state.container.binding.host &&
      url.port === String(state.container.binding.hostPort) &&
      decodeURIComponent(url.pathname.slice(1)) === state.database.databaseName &&
      decodeURIComponent(url.username) === state.database.databaseOwner &&
      url.password.length >= 16 &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

async function loadRecoveryDatabaseMaterial(input: {
  readonly repositoryRoot: string;
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly artifacts: LiveDemoDatabaseDisposeCapabilities["artifacts"];
}): Promise<ProtectedDatabaseMaterial | undefined> {
  const paths = createLiveDemoDatabasePaths(input.repositoryRoot);
  try {
    const recoveryPath = path.join(paths.root, "recovery-material.json");
    if (!(await input.artifacts.verifyOwnerOnly(recoveryPath))) return undefined;
    const serialized = await input.artifacts.readOwnerOnly(
      recoveryPath,
      maximumRecoveryMaterialBytes,
    );
    if (serialized === undefined) return undefined;
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, ["version", "databaseUrl", "provisioningAttestation"]) ||
      parsed["version"] !== 1 ||
      typeof parsed["databaseUrl"] !== "string"
    ) {
      return undefined;
    }
    const connectionString = parsed["databaseUrl"];
    const attestation = parseExactAttestation(
      JSON.stringify(parsed["provisioningAttestation"]),
      input.state,
    );
    if (attestation === undefined || !exactConnectionString(connectionString, input.state)) {
      return undefined;
    }
    return Object.freeze({ connectionString, attestation });
  } catch {
    return undefined;
  }
}

async function loadPublishedDatabaseMaterial(input: {
  readonly repositoryRoot: string;
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly artifacts: LiveDemoDatabaseDisposeCapabilities["artifacts"];
}): Promise<ProtectedDatabaseMaterial | undefined> {
  const paths = createLiveDemoDatabasePaths(input.repositoryRoot);
  try {
    for (const filePath of [
      paths.databaseUrl,
      paths.provisioningAttestation,
      paths.activationScript,
    ]) {
      if (!(await input.artifacts.verifyOwnerOnly(filePath))) return undefined;
    }
    const databaseUrlSerialized = await input.artifacts.readOwnerOnly(
      paths.databaseUrl,
      maximumDatabaseUrlBytes,
    );
    const attestationSerialized = await input.artifacts.readOwnerOnly(
      paths.provisioningAttestation,
      maximumAttestationBytes,
    );
    if (databaseUrlSerialized === undefined || attestationSerialized === undefined)
      return undefined;
    const connectionString = parseSingleProtectedLine(databaseUrlSerialized);
    const attestation = parseExactAttestation(attestationSerialized, input.state);
    if (
      connectionString === undefined ||
      attestation === undefined ||
      !exactConnectionString(connectionString, input.state)
    ) {
      return undefined;
    }
    return Object.freeze({ connectionString, attestation });
  } catch {
    return undefined;
  }
}

async function loadProtectedDatabaseMaterial(input: {
  readonly repositoryRoot: string;
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly artifacts: LiveDemoDatabaseDisposeCapabilities["artifacts"];
}): Promise<ProtectedDatabaseMaterial | undefined> {
  if (input.state.checkpoint === "database_owned") {
    return (
      (await loadRecoveryDatabaseMaterial(input)) ?? (await loadPublishedDatabaseMaterial(input))
    );
  }
  const published = await loadPublishedDatabaseMaterial(input);
  if (published !== undefined || input.state.checkpoint !== "database_removed") return published;
  return await loadRecoveryDatabaseMaterial(input);
}

async function persistTransition(input: {
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly next: LiveDemoDatabaseLifecycleState;
  readonly state: LiveDemoDatabaseDisposeCapabilities["state"];
}): Promise<LiveDemoDatabaseLifecycleState | undefined> {
  try {
    const persisted = await persistLiveDemoDatabaseLifecycleTransition({
      current: input.current,
      next: input.next,
      statePublication: input.state,
    });
    return persisted.outcome === "transitioned" ? persisted.state : undefined;
  } catch {
    return undefined;
  }
}

async function enterDisposing(input: {
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly state: LiveDemoDatabaseDisposeCapabilities["state"];
}): Promise<LiveDemoDatabaseLifecycleState | undefined> {
  let current = input.current;
  if (current.status === "starting") {
    const cleanupRequired = transitionLiveDemoDatabaseLifecycleState(current, {
      status: "cleanup_required",
      checkpoint: current.checkpoint,
    });
    const persisted = await persistTransition({
      current,
      next: cleanupRequired,
      state: input.state,
    });
    if (persisted === undefined) return undefined;
    current = persisted;
  }
  if (current.status === "disposing") return current;
  const disposing = transitionLiveDemoDatabaseLifecycleState(current, {
    status: "disposing",
    checkpoint: current.checkpoint,
  });
  return await persistTransition({ current, next: disposing, state: input.state });
}

async function proveDatabaseAbsent(input: {
  readonly state: LiveDemoDatabaseLifecycleState;
  readonly material: ProtectedDatabaseMaterial;
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
  readonly allowTeardown: boolean;
}): Promise<boolean> {
  if (input.state.database === null) return false;
  const expectedProvisioningOwnershipDigest = input.state.database.provisioningOwnershipDigest;
  if (!digestPattern.test(expectedProvisioningOwnershipDigest)) return false;
  let owner: ReturnType<
    LiveDemoDatabaseDisposeOwnershipCapabilities["createDisposablePostgresOwner"]
  >;
  try {
    owner = input.capabilities.ownership.createDisposablePostgresOwner(
      input.material.connectionString,
      { loadProvisioningAttestation: async () => input.material.attestation },
    );
  } catch {
    return false;
  }
  try {
    if (input.allowTeardown) {
      const ownership = await owner.attestOwnership();
      if (ownership.outcome === "owned") {
        if (
          ownership.exclusive !== true ||
          ownership.provisioningOwnershipDigest !== expectedProvisioningOwnershipDigest
        ) {
          return false;
        }
        try {
          await owner.teardown({
            closeConnections: input.capabilities.closeConnections,
            expectedProvisioningOwnershipDigest,
          });
        } catch {
          // A lost acknowledgement after DROP is recoverable only through the exact deletion proof.
        }
      } else if (ownership.outcome !== "missing") {
        return false;
      }
    }
    return await owner.verifyDeleted({ expectedProvisioningOwnershipDigest });
  } catch {
    return false;
  }
}

async function checkpointDatabaseRemoved(input: {
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly material: ProtectedDatabaseMaterial;
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
}): Promise<LiveDemoDatabaseLifecycleState | undefined> {
  if (
    !(await proveDatabaseAbsent({
      state: input.current,
      material: input.material,
      capabilities: input.capabilities,
      allowTeardown: true,
    }))
  ) {
    return undefined;
  }
  const next = transitionLiveDemoDatabaseLifecycleState(input.current, {
    status: "disposing",
    checkpoint: "database_removed",
  });
  return await persistTransition({ current: input.current, next, state: input.capabilities.state });
}

async function checkpointContainerRemoved(input: {
  readonly repositoryRoot: string;
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
}): Promise<LiveDemoDatabaseLifecycleState | undefined> {
  const proof = input.current.container;
  if (proof === null) return undefined;
  let inspection: "exact" | "mismatch" | "unavailable";
  try {
    inspection = await inspectExactContainer({
      repositoryRoot: input.repositoryRoot,
      proof,
      process: input.capabilities.process,
    });
  } catch {
    return undefined;
  }
  if (inspection === "mismatch") return undefined;
  if (inspection === "exact") {
    let removed: LiveDemoDatabaseProcessResult;
    try {
      removed = await input.capabilities.process.run(
        dockerRequest(input.repositoryRoot, ["rm", "--force", proof.id]),
      );
    } catch {
      return undefined;
    }
    if (removed.exitCode !== 0) return undefined;
  } else {
    try {
      if (
        !(await verifyContainerAbsent({
          repositoryRoot: input.repositoryRoot,
          proof,
          process: input.capabilities.process,
        }))
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  try {
    if (
      !(await verifyContainerAbsent({
        repositoryRoot: input.repositoryRoot,
        proof,
        process: input.capabilities.process,
      }))
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const next = transitionLiveDemoDatabaseLifecycleState(input.current, {
    status: "disposing",
    checkpoint: "container_removed",
  });
  return await persistTransition({ current: input.current, next, state: input.capabilities.state });
}

async function removeArtifactsLast(input: {
  readonly repositoryRoot: string;
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
}): Promise<boolean> {
  const paths = createLiveDemoDatabasePaths(input.repositoryRoot);
  const transientPaths = [
    path.join(paths.root, "container.cid"),
    path.join(paths.root, "container-labels.tmp"),
    path.join(paths.root, "recovery-material.json"),
  ];
  try {
    for (const filePath of [
      paths.databaseUrl,
      paths.provisioningAttestation,
      paths.activationScript,
      ...transientPaths,
    ]) {
      if (
        !(await input.capabilities.artifacts.removeWithin(filePath, protectedFileCleanupTimeoutMs))
      ) {
        return false;
      }
    }
    return await input.capabilities.state.removeExact(
      serializeLiveDemoDatabaseLifecycleState(input.current),
    );
  } catch {
    return false;
  }
}

async function removePreCreateTransients(input: {
  readonly repositoryRoot: string;
  readonly artifacts: LiveDemoDatabaseDisposeCapabilities["artifacts"];
}): Promise<boolean> {
  const root = createLiveDemoDatabasePaths(input.repositoryRoot).root;
  for (const filePath of [
    path.join(root, "container.cid"),
    path.join(root, "container-labels.tmp"),
  ]) {
    if (!(await input.artifacts.removeWithin(filePath, protectedFileCleanupTimeoutMs))) {
      return false;
    }
  }
  return true;
}

async function removePreCreateArtifactsLast(input: {
  readonly repositoryRoot: string;
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
}): Promise<boolean> {
  try {
    if (
      !(await removePreCreateTransients({
        repositoryRoot: input.repositoryRoot,
        artifacts: input.capabilities.artifacts,
      }))
    ) {
      return false;
    }
    return await input.capabilities.state.removeExact(
      serializeLiveDemoDatabaseLifecycleState(input.current),
    );
  } catch {
    return false;
  }
}

type AmbiguousCreateReconciliation =
  | Readonly<{ outcome: "adopted"; state: LiveDemoDatabaseLifecycleState }>
  | Readonly<{ outcome: "finished"; result: LiveDemoDatabaseDisposeResult }>;

async function reconcileAmbiguousCreate(input: {
  readonly repositoryRoot: string;
  readonly current: LiveDemoDatabaseLifecycleState;
  readonly capabilities: LiveDemoDatabaseDisposeCapabilities;
}): Promise<AmbiguousCreateReconciliation> {
  let current = input.current;
  try {
    if (current.status === "cleanup_required") {
      const disposing = await enterDisposing({ current, state: input.capabilities.state });
      if (disposing === undefined) {
        return Object.freeze({ outcome: "finished", result: blocked() });
      }
      current = disposing;
    }
    if (current.status !== "disposing" || current.checkpoint !== "state_created") {
      return Object.freeze({ outcome: "finished", result: blocked() });
    }

    const first = await queryAmbiguousCreateCandidateSnapshot({
      repositoryRoot: input.repositoryRoot,
      state: current,
      process: input.capabilities.process,
    });
    if (first === undefined) {
      return Object.freeze({ outcome: "finished", result: blocked() });
    }
    await input.capabilities.wait(ambiguousCreateQuiescenceMs);
    const second = await queryAmbiguousCreateCandidateSnapshot({
      repositoryRoot: input.repositoryRoot,
      state: current,
      process: input.capabilities.process,
    });
    if (second === undefined || second.id !== first.id) {
      return Object.freeze({ outcome: "finished", result: blocked() });
    }

    if (second.id !== null) {
      const proof: LiveDemoDatabaseContainerProof = Object.freeze({
        id: second.id,
        ...current.containerIntent,
      });
      const inspection = await inspectExactContainer({
        repositoryRoot: input.repositoryRoot,
        proof,
        process: input.capabilities.process,
      });
      if (inspection !== "exact") {
        return Object.freeze({ outcome: "finished", result: blocked() });
      }
      const next = transitionLiveDemoDatabaseLifecycleState(current, {
        status: "disposing",
        checkpoint: "container_created",
        container: proof,
      });
      const persisted = await persistTransition({
        current,
        next,
        state: input.capabilities.state,
      });
      return persisted === undefined
        ? Object.freeze({ outcome: "finished", result: blocked() })
        : Object.freeze({ outcome: "adopted", state: persisted });
    }

    if (
      !(await removePreCreateTransients({
        repositoryRoot: input.repositoryRoot,
        artifacts: input.capabilities.artifacts,
      }))
    ) {
      return Object.freeze({ outcome: "finished", result: blocked() });
    }
    const final = await queryAmbiguousCreateCandidateSnapshot({
      repositoryRoot: input.repositoryRoot,
      state: current,
      process: input.capabilities.process,
    });
    if (final === undefined || final.id !== null) {
      return Object.freeze({ outcome: "finished", result: blocked() });
    }
    const removed = await input.capabilities.state.removeExact(
      serializeLiveDemoDatabaseLifecycleState(current),
    );
    return Object.freeze({
      outcome: "finished",
      result: removed
        ? Object.freeze({
            outcome: "disposed" as const,
            message: LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
          })
        : blocked(),
    });
  } catch {
    return Object.freeze({ outcome: "finished", result: blocked() });
  }
}

export async function disposeLiveDemoDatabase(
  input: Readonly<{
    repositoryRoot: string;
    capabilities: LiveDemoDatabaseDisposeCapabilities;
  }>,
): Promise<LiveDemoDatabaseDisposeResult> {
  let current: LiveDemoDatabaseLifecycleState;
  try {
    const serialized = await input.capabilities.state.loadOwnerOnly(maximumStateBytes);
    if (serialized === undefined) return blocked();
    current = parseLiveDemoDatabaseLifecycleState(JSON.parse(serialized));
    createLiveDemoDatabasePaths(input.repositoryRoot);
  } catch {
    return blocked();
  }
  if (current.checkpoint === "state_created") {
    if (
      current.container !== null ||
      (current.status !== "cleanup_required" && current.status !== "disposing")
    ) {
      return blocked();
    }
    const reconciliation = await reconcileAmbiguousCreate({
      repositoryRoot: input.repositoryRoot,
      current,
      capabilities: input.capabilities,
    });
    if (reconciliation.outcome === "finished") return reconciliation.result;
    current = reconciliation.state;
  }
  if (current.container === null) return blocked();

  if (current.checkpoint === "container_created" && current.database === null) {
    try {
      const recoveryPath = path.join(
        createLiveDemoDatabasePaths(input.repositoryRoot).root,
        "recovery-material.json",
      );
      // This combination is the crash window after database sealing but before its lifecycle
      // transition. Treat it as post-ownership and retain both proofs for manual recovery.
      if (await input.capabilities.artifacts.verifyOwnerOnly(recoveryPath)) return blocked();
    } catch {
      return blocked();
    }
  }

  if (current.checkpoint === "container_removed") {
    const artifactsRemoved =
      current.database === null
        ? await removePreCreateArtifactsLast({
            repositoryRoot: input.repositoryRoot,
            current,
            capabilities: input.capabilities,
          })
        : await removeArtifactsLast({
            repositoryRoot: input.repositoryRoot,
            current,
            capabilities: input.capabilities,
          });
    return artifactsRemoved
      ? Object.freeze({
          outcome: "disposed" as const,
          message: LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
        })
      : blocked();
  }

  if (current.checkpoint === "database_removed") {
    let inspection: "exact" | "mismatch" | "unavailable";
    try {
      inspection = await inspectExactContainer({
        repositoryRoot: input.repositoryRoot,
        proof: current.container,
        process: input.capabilities.process,
      });
      if (inspection === "mismatch") return blocked();
      if (
        inspection === "unavailable" &&
        (await verifyContainerAbsent({
          repositoryRoot: input.repositoryRoot,
          proof: current.container,
          process: input.capabilities.process,
        }))
      ) {
        const disposing = await enterDisposing({ current, state: input.capabilities.state });
        if (disposing === undefined) return blocked();
        const next = transitionLiveDemoDatabaseLifecycleState(disposing, {
          status: "disposing",
          checkpoint: "container_removed",
        });
        const containerRemoved = await persistTransition({
          current: disposing,
          next,
          state: input.capabilities.state,
        });
        if (containerRemoved === undefined) return blocked();
        return (await removeArtifactsLast({
          repositoryRoot: input.repositoryRoot,
          current: containerRemoved,
          capabilities: input.capabilities,
        }))
          ? Object.freeze({
              outcome: "disposed" as const,
              message: LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
            })
          : blocked();
      }
      if (inspection !== "exact") return blocked();
    } catch {
      return blocked();
    }
  }

  let material: ProtectedDatabaseMaterial | undefined;
  if (current.database !== null) {
    material = await loadProtectedDatabaseMaterial({
      repositoryRoot: input.repositoryRoot,
      state: current,
      artifacts: input.capabilities.artifacts,
    });
    if (material === undefined) return blocked();
  }

  if (current.checkpoint !== "database_removed") {
    try {
      const inspection = await inspectExactContainer({
        repositoryRoot: input.repositoryRoot,
        proof: current.container,
        process: input.capabilities.process,
      });
      const priorContainerRemovalProven =
        current.checkpoint === "container_created" &&
        inspection === "unavailable" &&
        (await verifyContainerAbsent({
          repositoryRoot: input.repositoryRoot,
          proof: current.container,
          process: input.capabilities.process,
        }));
      if (inspection !== "exact" && !priorContainerRemovalProven) {
        return blocked();
      }
    } catch {
      return blocked();
    }
  }

  const disposing = await enterDisposing({ current, state: input.capabilities.state });
  if (disposing === undefined) return blocked();
  current = disposing;

  if (current.checkpoint === "database_owned" || current.checkpoint === "artifacts_published") {
    if (material === undefined) return blocked();
    const databaseRemoved = await checkpointDatabaseRemoved({
      current,
      material,
      capabilities: input.capabilities,
    });
    if (databaseRemoved === undefined) return blocked();
    current = databaseRemoved;
  } else if (current.checkpoint === "database_removed") {
    if (
      material === undefined ||
      !(await proveDatabaseAbsent({
        state: current,
        material,
        capabilities: input.capabilities,
        allowTeardown: false,
      }))
    ) {
      return blocked();
    }
  }

  if (current.checkpoint !== "container_removed") {
    const containerRemoved = await checkpointContainerRemoved({
      repositoryRoot: input.repositoryRoot,
      current,
      capabilities: input.capabilities,
    });
    if (containerRemoved === undefined) return blocked();
    current = containerRemoved;
  }

  const artifactsRemoved =
    current.database === null
      ? await removePreCreateArtifactsLast({
          repositoryRoot: input.repositoryRoot,
          current,
          capabilities: input.capabilities,
        })
      : await removeArtifactsLast({
          repositoryRoot: input.repositoryRoot,
          current,
          capabilities: input.capabilities,
        });
  if (!artifactsRemoved) {
    return blocked();
  }
  return Object.freeze({
    outcome: "disposed" as const,
    message: LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
  });
}

export { LIVE_DEMO_DATABASE_ATTENTION_MESSAGE, LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE };

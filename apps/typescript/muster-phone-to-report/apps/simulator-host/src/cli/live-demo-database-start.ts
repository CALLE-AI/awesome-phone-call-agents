import { randomBytes, randomInt, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createLiveDemoDatabasePaths,
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
  LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
} from "./live-demo-database-contract.js";
import {
  beginLiveDemoDatabaseLifecycle,
  persistLiveDemoDatabaseLifecycleTransition,
  publishLiveDemoDatabaseArtifacts,
  type LiveDemoDatabaseArtifactPublication,
  type LiveDemoDatabaseStatePublication,
} from "./live-demo-database-lifecycle.js";
import {
  LIVE_DEMO_DATABASE_PINNED_IMAGE,
  transitionLiveDemoDatabaseLifecycleState,
  type LiveDemoDatabaseContainerOwnershipIntent,
  type LiveDemoDatabaseContainerProof,
  type LiveDemoDatabaseLifecycleState,
} from "./live-demo-database-state.js";

const dockerExecutable = "docker";
const prismaCli = fileURLToPath(import.meta.resolve("prisma/build/index.js"));
const containerPort = 5432;
const readinessAttempts = 30;
const readinessIntervalMs = 1_000;
const shortProcessTimeoutMs = 10_000;
const dockerCreateTimeoutMs = 30_000;
const inspectTimeoutMs = 2_000;
const migrationTimeoutMs = 120_000;
const protectedFileCleanupTimeoutMs = 2_000;
const maximumCidFileBytes = 128;
const tmpfsSpecification = "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=536870912";
const safeInspectFormat =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"HostConfig":{"PortBindings":{{json .HostConfig.PortBindings}},"Tmpfs":{{json .HostConfig.Tmpfs}}},"State":{"Status":{{json .State.Status}},"Health":{"Status":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}}}}}';
const containerIdPattern = /^[0-9a-f]{64}$/u;
const ownershipTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const suffixPattern = /^[a-z0-9]{8,32}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

export interface LiveDemoDatabaseProcessRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly standardInput?: string;
  readonly timeoutMs: number;
  readonly output: "capture_suppressed" | "ignore";
}

export interface LiveDemoDatabaseProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface LiveDemoDatabaseStartIdentityCapabilities {
  createSessionId(): string;
  nowIso(): string;
  createDatabaseSuffix(): string;
  createPassword(): string;
  createOwnershipToken(purpose: "container" | "database"): string;
  createHostPort(): number;
}

export interface LiveDemoDatabaseStartOwnershipCapabilities {
  provisionExclusiveDisposablePostgresDatabaseOwnership(input: {
    readonly connectionString: string;
    readonly ownershipToken: string;
  }): Promise<LiveDemoDatabaseProvisioningAttestation>;
  createDisposablePostgresOwner(
    connectionString: string,
    input: Readonly<{ loadProvisioningAttestation: () => Promise<unknown> }>,
  ): Readonly<{
    attestOwnership(): Promise<LiveDemoDatabaseOwnershipAttestation>;
  }>;
}

export interface LiveDemoDatabaseProvisioningAttestation {
  readonly version: 1;
  readonly databaseName: string;
  readonly databaseOid: string;
  readonly clusterSystemIdentifier: string;
  readonly ownershipToken: string;
  readonly exclusive: true;
}

export type LiveDemoDatabaseOwnershipAttestation =
  | Readonly<{
      outcome: "owned";
      exclusive: true;
      provisioningOwnershipDigest: string;
    }>
  | Readonly<{ outcome: "mismatch" | "missing" | "indeterminate" }>;

export interface LiveDemoDatabaseStartCapabilities {
  readonly identity: LiveDemoDatabaseStartIdentityCapabilities;
  readonly process: {
    run(request: LiveDemoDatabaseProcessRequest): Promise<LiveDemoDatabaseProcessResult>;
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
  readonly ownership: LiveDemoDatabaseStartOwnershipCapabilities;
}

export type LiveDemoDatabaseStartResult =
  | Readonly<{
      outcome: "ready";
      message: typeof LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE;
      activationScript: string;
    }>
  | Readonly<{
      outcome: "blocked" | "cleanup_required";
      message: typeof LIVE_DEMO_DATABASE_ATTENTION_MESSAGE;
    }>;

export const defaultLiveDemoDatabaseStartIdentityCapabilities: LiveDemoDatabaseStartIdentityCapabilities =
  Object.freeze({
    createSessionId: () => randomUUID(),
    nowIso: () => new Date().toISOString(),
    createDatabaseSuffix: () => randomBytes(12).toString("hex"),
    createPassword: () => randomBytes(32).toString("base64url"),
    createOwnershipToken: () => randomBytes(32).toString("base64url"),
    createHostPort: () => randomInt(49_152, 65_536),
  });

interface GeneratedStartIdentity {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly databaseName: string;
  readonly databaseOwner: string;
  readonly password: string;
  readonly containerOwnershipToken: string;
  readonly databaseOwnershipToken: string;
  readonly hostPort: number;
  readonly containerName: string;
}

function attention(outcome: "blocked" | "cleanup_required"): LiveDemoDatabaseStartResult {
  return Object.freeze({ outcome, message: LIVE_DEMO_DATABASE_ATTENTION_MESSAGE });
}

function generateStartIdentity(
  capabilities: LiveDemoDatabaseStartIdentityCapabilities,
): GeneratedStartIdentity {
  const sessionId = capabilities.createSessionId();
  const createdAt = capabilities.nowIso();
  const suffix = capabilities.createDatabaseSuffix();
  const password = capabilities.createPassword();
  const containerOwnershipToken = capabilities.createOwnershipToken("container");
  const databaseOwnershipToken = capabilities.createOwnershipToken("database");
  const hostPort = capabilities.createHostPort();
  if (
    !sessionIdPattern.test(sessionId) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt ||
    !suffixPattern.test(suffix) ||
    password.length < 16 ||
    /[\0\r\n]/u.test(password) ||
    !ownershipTokenPattern.test(containerOwnershipToken) ||
    !ownershipTokenPattern.test(databaseOwnershipToken) ||
    containerOwnershipToken === databaseOwnershipToken ||
    !Number.isSafeInteger(hostPort) ||
    hostPort < 49_152 ||
    hostPort > 65_535
  ) {
    throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  }
  return Object.freeze({
    sessionId,
    createdAt,
    databaseName: `muster_live_demo_${suffix}`,
    databaseOwner: `muster_live_demo_owner_${suffix}`,
    password,
    containerOwnershipToken,
    databaseOwnershipToken,
    hostPort,
    containerName: `muster-live-demo-database-${sessionId}`,
  });
}

function createConnectionString(identity: GeneratedStartIdentity): string {
  const url = new URL(`postgresql://127.0.0.1:${identity.hostPort}/${identity.databaseName}`);
  url.username = identity.databaseOwner;
  url.password = identity.password;
  return url.toString();
}

function createContainerRequest(
  repositoryRoot: string,
  identity: GeneratedStartIdentity,
  protectedFiles: Readonly<{ labelFile: string; cidFile: string }>,
): LiveDemoDatabaseProcessRequest {
  return Object.freeze({
    executable: dockerExecutable,
    arguments: Object.freeze([
      "create",
      "--name",
      identity.containerName,
      "--cidfile",
      protectedFiles.cidFile,
      "--label-file",
      protectedFiles.labelFile,
      "--publish",
      `127.0.0.1:${identity.hostPort}:${containerPort}`,
      "--tmpfs",
      tmpfsSpecification,
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
      LIVE_DEMO_DATABASE_PINNED_IMAGE,
    ]),
    cwd: repositoryRoot,
    environment: Object.freeze({
      POSTGRES_DB: identity.databaseName,
      POSTGRES_PASSWORD: identity.password,
      POSTGRES_USER: identity.databaseOwner,
    }),
    timeoutMs: dockerCreateTimeoutMs,
    output: "capture_suppressed" as const,
  });
}

function dockerRequest(
  repositoryRoot: string,
  arguments_: readonly string[],
  timeoutMs: number = shortProcessTimeoutMs,
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

function parseContainerId(result: LiveDemoDatabaseProcessResult): string | undefined {
  if (result.exitCode !== 0) return undefined;
  const id = result.stdout.trim();
  return containerIdPattern.test(id) ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactContainerInspection(
  serialized: string,
  proof: LiveDemoDatabaseContainerProof,
): Readonly<{ exact: boolean; health: string | undefined }> {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return Object.freeze({ exact: false, health: undefined });
    const config = value["Config"];
    const hostConfig = value["HostConfig"];
    const state = value["State"];
    if (!isRecord(config) || !isRecord(hostConfig) || !isRecord(state)) {
      return Object.freeze({ exact: false, health: undefined });
    }
    const labels = config["Labels"];
    const bindings = hostConfig["PortBindings"];
    const tmpfs = hostConfig["Tmpfs"];
    const health = state["Health"];
    if (!isRecord(labels) || !isRecord(bindings) || !isRecord(tmpfs) || !isRecord(health)) {
      return Object.freeze({ exact: false, health: undefined });
    }
    const binding = bindings["5432/tcp"];
    if (!Array.isArray(binding) || binding.length !== 1 || !isRecord(binding[0])) {
      return Object.freeze({ exact: false, health: undefined });
    }
    const exact =
      value["Id"] === proof.id &&
      value["Name"] === `/${proof.name}` &&
      config["Image"] === proof.image &&
      labels["com.muster.live-demo-database.session"] ===
        proof.labels["com.muster.live-demo-database.session"] &&
      labels["com.muster.live-demo-database.owner"] ===
        proof.labels["com.muster.live-demo-database.owner"] &&
      binding[0]["HostIp"] === proof.binding.host &&
      binding[0]["HostPort"] === String(proof.binding.hostPort) &&
      tmpfs["/var/lib/postgresql/data"] ===
        tmpfsSpecification.slice("/var/lib/postgresql/data:".length);
    return Object.freeze({
      exact,
      health: typeof health["Status"] === "string" ? health["Status"] : undefined,
    });
  } catch {
    return Object.freeze({ exact: false, health: undefined });
  }
}

async function inspectExactContainer(
  input: Readonly<{
    repositoryRoot: string;
    proof: LiveDemoDatabaseContainerProof;
    capabilities: LiveDemoDatabaseStartCapabilities;
  }>,
): Promise<Readonly<{ exact: boolean; health: string | undefined }>> {
  const result = await input.capabilities.process.run(
    dockerRequest(
      input.repositoryRoot,
      ["inspect", "--type", "container", "--format", safeInspectFormat, input.proof.id],
      inspectTimeoutMs,
    ),
  );
  if (result.exitCode !== 0) return Object.freeze({ exact: false, health: undefined });
  return exactContainerInspection(result.stdout, input.proof);
}

async function waitUntilContainerReady(
  input: Readonly<{
    repositoryRoot: string;
    proof: LiveDemoDatabaseContainerProof;
    capabilities: LiveDemoDatabaseStartCapabilities;
  }>,
): Promise<boolean> {
  for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
    const inspection = await inspectExactContainer(input);
    if (!inspection.exact) return false;
    if (inspection.health === "healthy") return true;
    if (inspection.health === "unhealthy") return false;
    if (attempt + 1 < readinessAttempts) {
      await input.capabilities.wait(readinessIntervalMs);
    }
  }
  return false;
}

async function retainCleanupRequired(
  current: LiveDemoDatabaseLifecycleState,
  statePublication: LiveDemoDatabaseStatePublication,
): Promise<LiveDemoDatabaseStartResult> {
  let cleanupRequired: LiveDemoDatabaseLifecycleState;
  try {
    cleanupRequired = transitionLiveDemoDatabaseLifecycleState(current, {
      status: "cleanup_required",
      checkpoint: current.checkpoint,
    });
  } catch {
    return attention("blocked");
  }
  const retained = await persistLiveDemoDatabaseLifecycleTransition({
    current,
    next: cleanupRequired,
    statePublication,
  });
  return retained.outcome === "transitioned" ? attention("cleanup_required") : attention("blocked");
}

async function recoverStartupFailure(
  input: Readonly<{
    repositoryRoot: string;
    current: LiveDemoDatabaseLifecycleState;
    proof?: LiveDemoDatabaseContainerProof;
    capabilities: LiveDemoDatabaseStartCapabilities;
  }>,
): Promise<LiveDemoDatabaseStartResult> {
  if (input.proof !== undefined) {
    try {
      const inspection = await inspectExactContainer({
        repositoryRoot: input.repositoryRoot,
        proof: input.proof,
        capabilities: input.capabilities,
      });
      if (inspection.exact) {
        const removed = await input.capabilities.process.run(
          dockerRequest(input.repositoryRoot, ["rm", "--force", input.proof.id]),
        );
        if (removed.exitCode === 0) {
          const verified = await input.capabilities.process.run(
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
          if (verified.exitCode !== 0 || verified.stdout.trim() !== "") {
            // The full proof remains retained for a retry-safe dispose.
          }
        }
      }
    } catch {
      // Ambiguity is intentionally retained in the fixed lifecycle record.
    }
  }
  const retained = await retainCleanupRequired(input.current, input.capabilities.statePublication);
  return retained;
}

function protectedContainerFiles(repositoryRoot: string): Readonly<{
  labelFile: string;
  cidFile: string;
  recoveryMaterial: string;
}> {
  const root = createLiveDemoDatabasePaths(repositoryRoot).root;
  return Object.freeze({
    labelFile: path.join(root, "container-labels.tmp"),
    cidFile: path.join(root, "container.cid"),
    recoveryMaterial: path.join(root, "recovery-material.json"),
  });
}

function containerLabels(identity: GeneratedStartIdentity): string {
  return (
    `com.muster.live-demo-database.session=${identity.sessionId}\n` +
    `com.muster.live-demo-database.owner=${identity.containerOwnershipToken}\n`
  );
}

async function loadProtectedContainerId(
  input: Readonly<{
    cidFile: string;
    capabilities: LiveDemoDatabaseStartCapabilities;
  }>,
): Promise<string | undefined> {
  try {
    if (!(await input.capabilities.protectedFiles.protectExisting(input.cidFile))) {
      return undefined;
    }
    if (!(await input.capabilities.protectedFiles.verifyOwnerOnly(input.cidFile))) {
      return undefined;
    }
    const serialized = await input.capabilities.protectedFiles.readOwnerOnly(
      input.cidFile,
      maximumCidFileBytes,
    );
    if (serialized === undefined) return undefined;
    const containerId = serialized.trim();
    return containerIdPattern.test(containerId) ? containerId : undefined;
  } catch {
    return undefined;
  }
}

function createContainerIntent(
  identity: GeneratedStartIdentity,
): LiveDemoDatabaseContainerOwnershipIntent {
  return Object.freeze({
    name: identity.containerName,
    image: LIVE_DEMO_DATABASE_PINNED_IMAGE,
    ownershipToken: identity.containerOwnershipToken,
    labels: Object.freeze({
      "com.muster.live-demo-database.session": identity.sessionId,
      "com.muster.live-demo-database.owner": identity.containerOwnershipToken,
    }),
    binding: Object.freeze({
      host: "127.0.0.1" as const,
      hostPort: identity.hostPort,
      containerPort: containerPort as 5432,
    }),
    storage: "tmpfs" as const,
  });
}

function createContainerProof(
  intent: LiveDemoDatabaseContainerOwnershipIntent,
  containerId: string,
): LiveDemoDatabaseContainerProof {
  return Object.freeze({ id: containerId, ...intent });
}

function exactProvisioningAttestation(
  attestation: LiveDemoDatabaseProvisioningAttestation,
  identity: GeneratedStartIdentity,
): boolean {
  return (
    attestation.version === 1 &&
    attestation.exclusive === true &&
    attestation.databaseName === identity.databaseName &&
    attestation.ownershipToken === identity.databaseOwnershipToken
  );
}

function migrationRequest(
  repositoryRoot: string,
  connectionString: string,
): LiveDemoDatabaseProcessRequest {
  return Object.freeze({
    executable: process.execPath,
    arguments: Object.freeze([prismaCli, "migrate", "deploy"]),
    cwd: repositoryRoot,
    environment: Object.freeze({ MIGRATION_DATABASE_URL: connectionString }),
    timeoutMs: migrationTimeoutMs,
    output: "ignore" as const,
  });
}

export async function startLiveDemoDatabase(
  input: Readonly<{
    repositoryRoot: string;
    capabilities: LiveDemoDatabaseStartCapabilities;
  }>,
): Promise<LiveDemoDatabaseStartResult> {
  let identity: GeneratedStartIdentity;
  let protectedFiles: Readonly<{
    labelFile: string;
    cidFile: string;
    recoveryMaterial: string;
  }>;
  try {
    protectedFiles = protectedContainerFiles(input.repositoryRoot);
    identity = generateStartIdentity(input.capabilities.identity);
  } catch {
    return attention("blocked");
  }
  const containerIntent = createContainerIntent(identity);

  // Persist exact creation intent before Docker runs so cidfile recovery can resolve an
  // ambiguous create without trusting container names, labels, or broad discovery.
  const begun = await beginLiveDemoDatabaseLifecycle({
    sessionId: identity.sessionId,
    createdAt: identity.createdAt,
    containerIntent,
    statePublication: input.capabilities.statePublication,
  });
  if (begun.outcome !== "started") return attention("blocked");
  const initialState = begun.state;

  try {
    const labelFileCreated = await input.capabilities.protectedFiles.createOwnerOnlyExclusive({
      path: protectedFiles.labelFile,
      contents: containerLabels(identity),
    });
    if (
      !labelFileCreated ||
      !(await input.capabilities.protectedFiles.verifyOwnerOnly(protectedFiles.labelFile))
    ) {
      if (labelFileCreated) {
        await input.capabilities.protectedFiles.removeWithin(
          protectedFiles.labelFile,
          protectedFileCleanupTimeoutMs,
        );
      }
      await retainCleanupRequired(initialState, input.capabilities.statePublication);
      return attention("blocked");
    }
  } catch {
    await retainCleanupRequired(initialState, input.capabilities.statePublication);
    return attention("blocked");
  }

  let createResult: LiveDemoDatabaseProcessResult | undefined;
  let createThrew = false;
  try {
    createResult = await input.capabilities.process.run(
      createContainerRequest(input.repositoryRoot, identity, protectedFiles),
    );
  } catch {
    createThrew = true;
  }
  let labelFileRemoved: boolean;
  try {
    labelFileRemoved = await input.capabilities.protectedFiles.removeWithin(
      protectedFiles.labelFile,
      protectedFileCleanupTimeoutMs,
    );
  } catch {
    labelFileRemoved = false;
  }

  const containerId = await loadProtectedContainerId({
    cidFile: protectedFiles.cidFile,
    capabilities: input.capabilities,
  });
  if (containerId === undefined) {
    await retainCleanupRequired(initialState, input.capabilities.statePublication);
    return attention("blocked");
  }
  const containerProof = createContainerProof(containerIntent, containerId);
  // The cidfile identifies only a candidate; exact inspection must match the durable intent
  // before the designated transition admits that candidate as destructive-work proof.
  let inspection: Readonly<{ exact: boolean; health: string | undefined }>;
  try {
    inspection = await inspectExactContainer({
      repositoryRoot: input.repositoryRoot,
      proof: containerProof,
      capabilities: input.capabilities,
    });
  } catch {
    await retainCleanupRequired(initialState, input.capabilities.statePublication);
    return attention("blocked");
  }
  if (!inspection.exact) {
    await retainCleanupRequired(initialState, input.capabilities.statePublication);
    return attention("blocked");
  }
  const containerState = transitionLiveDemoDatabaseLifecycleState(initialState, {
    status: "starting",
    checkpoint: "container_created",
    container: containerProof,
  });
  const persistedContainer = await persistLiveDemoDatabaseLifecycleTransition({
    current: initialState,
    next: containerState,
    statePublication: input.capabilities.statePublication,
  });
  if (persistedContainer.outcome !== "transitioned") {
    return attention("blocked");
  }

  const reportedContainerId =
    createResult === undefined ? undefined : parseContainerId(createResult);
  if (!labelFileRemoved) {
    await recoverStartupFailure({
      repositoryRoot: input.repositoryRoot,
      current: containerState,
      proof: containerProof,
      capabilities: input.capabilities,
    });
    return attention("blocked");
  }
  if (createThrew || reportedContainerId !== containerId) {
    return await recoverStartupFailure({
      repositoryRoot: input.repositoryRoot,
      current: containerState,
      proof: containerProof,
      capabilities: input.capabilities,
    });
  }
  try {
    if (
      !(await input.capabilities.protectedFiles.removeWithin(
        protectedFiles.cidFile,
        protectedFileCleanupTimeoutMs,
      ))
    ) {
      return await recoverStartupFailure({
        repositoryRoot: input.repositoryRoot,
        current: containerState,
        proof: containerProof,
        capabilities: input.capabilities,
      });
    }
  } catch {
    return await recoverStartupFailure({
      repositoryRoot: input.repositoryRoot,
      current: containerState,
      proof: containerProof,
      capabilities: input.capabilities,
    });
  }

  try {
    const started = await input.capabilities.process.run(
      dockerRequest(input.repositoryRoot, ["start", containerProof.id]),
    );
    if (started.exitCode !== 0) throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    if (
      !(await waitUntilContainerReady({
        repositoryRoot: input.repositoryRoot,
        proof: containerProof,
        capabilities: input.capabilities,
      }))
    ) {
      throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    }
  } catch {
    return await recoverStartupFailure({
      repositoryRoot: input.repositoryRoot,
      current: containerState,
      proof: containerProof,
      capabilities: input.capabilities,
    });
  }

  const connectionString = createConnectionString(identity);
  let provisioningAttestation: LiveDemoDatabaseProvisioningAttestation;
  let ownershipDigest: string;
  try {
    provisioningAttestation =
      await input.capabilities.ownership.provisionExclusiveDisposablePostgresDatabaseOwnership({
        connectionString,
        ownershipToken: identity.databaseOwnershipToken,
      });
    if (!exactProvisioningAttestation(provisioningAttestation, identity)) {
      throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    }
    const migration = await input.capabilities.process.run(
      migrationRequest(input.repositoryRoot, connectionString),
    );
    if (migration.exitCode !== 0) throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    const owner = input.capabilities.ownership.createDisposablePostgresOwner(connectionString, {
      loadProvisioningAttestation: async () => provisioningAttestation,
    });
    const ownership = await owner.attestOwnership();
    if (
      ownership.outcome !== "owned" ||
      ownership.exclusive !== true ||
      !digestPattern.test(ownership.provisioningOwnershipDigest)
    ) {
      throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    }
    ownershipDigest = ownership.provisioningOwnershipDigest;
  } catch {
    return await recoverStartupFailure({
      repositoryRoot: input.repositoryRoot,
      current: containerState,
      proof: containerProof,
      capabilities: input.capabilities,
    });
  }

  let databaseOwnedState: LiveDemoDatabaseLifecycleState;
  try {
    databaseOwnedState = transitionLiveDemoDatabaseLifecycleState(containerState, {
      status: "starting",
      checkpoint: "database_owned",
      database: Object.freeze({
        databaseName: identity.databaseName,
        databaseOwner: identity.databaseOwner,
        provisioningOwnershipDigest: ownershipDigest,
        attestationVersion: 1 as const,
      }),
    });
  } catch {
    return attention("blocked");
  }

  let recoveryCreated = false;
  try {
    recoveryCreated = await input.capabilities.protectedFiles.createOwnerOnlyExclusive({
      path: protectedFiles.recoveryMaterial,
      contents: `${JSON.stringify({
        version: 1,
        databaseUrl: connectionString,
        provisioningAttestation,
      })}\n`,
    });
    if (
      !recoveryCreated ||
      !(await input.capabilities.protectedFiles.verifyOwnerOnly(protectedFiles.recoveryMaterial))
    ) {
      throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    }
  } catch {
    if (recoveryCreated) {
      try {
        await input.capabilities.protectedFiles.removeWithin(
          protectedFiles.recoveryMaterial,
          protectedFileCleanupTimeoutMs,
        );
      } catch {
        // The fixed owner-only path and exact database proof are retained for operator recovery.
      }
    }
    const persistedOwnedDatabase = await persistLiveDemoDatabaseLifecycleTransition({
      current: containerState,
      next: databaseOwnedState,
      statePublication: input.capabilities.statePublication,
    });
    if (persistedOwnedDatabase.outcome !== "transitioned") return attention("blocked");
    return await retainCleanupRequired(databaseOwnedState, input.capabilities.statePublication);
  }

  const persistedDatabase = await persistLiveDemoDatabaseLifecycleTransition({
    current: containerState,
    next: databaseOwnedState,
    statePublication: input.capabilities.statePublication,
  });
  if (persistedDatabase.outcome !== "transitioned") {
    // PostgreSQL is already sealed and migrated. The prior container-only rollback is no
    // longer safe; retain both independent proofs for an owner-authorized recovery instead.
    return attention("blocked");
  }

  const published = await publishLiveDemoDatabaseArtifacts({
    repositoryRoot: input.repositoryRoot,
    current: databaseOwnedState,
    databaseUrl: connectionString,
    provisioningAttestationJson: JSON.stringify(provisioningAttestation),
    statePublication: input.capabilities.statePublication,
    artifactPublication: input.capabilities.artifactPublication,
    beforeReadyTransition: async () =>
      await input.capabilities.protectedFiles.removeWithin(
        protectedFiles.recoveryMaterial,
        protectedFileCleanupTimeoutMs,
      ),
  });
  if (published.outcome !== "published") {
    return attention(published.outcome === "cleanup_required" ? "cleanup_required" : "blocked");
  }
  return Object.freeze({
    outcome: "ready" as const,
    message: LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
    activationScript: createLiveDemoDatabasePaths(input.repositoryRoot).activationScript,
  });
}

export {
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
  LIVE_DEMO_DATABASE_PINNED_IMAGE,
  LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
};

export const LIVE_DEMO_DATABASE_PINNED_IMAGE =
  "postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";

const INVALID_STATE_MESSAGE = "Disposable live-demo database lifecycle state is invalid";
const INVALID_TRANSITION_MESSAGE = "Disposable live-demo database lifecycle transition is invalid";
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const containerIdPattern = /^[0-9a-f]{64}$/u;
const ownershipTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const databaseNamePattern = /^muster_live_demo_[a-z0-9]{8,32}$/u;
const databaseOwnerPattern = /^muster_live_demo_owner_[a-z0-9]{8,32}$/u;

export type LiveDemoDatabaseLifecycleStatus =
  "starting" | "ready" | "cleanup_required" | "disposing";

export type LiveDemoDatabaseLifecycleCheckpoint =
  | "state_created"
  | "container_created"
  | "database_owned"
  | "artifacts_published"
  | "database_removed"
  | "container_removed";

export interface LiveDemoDatabaseSessionProof {
  readonly id: string;
  readonly createdAt: string;
}

export interface LiveDemoDatabaseContainerProof {
  readonly id: string;
  readonly name: string;
  readonly image: typeof LIVE_DEMO_DATABASE_PINNED_IMAGE;
  readonly ownershipToken: string;
  readonly labels: Readonly<{
    "com.muster.live-demo-database.session": string;
    "com.muster.live-demo-database.owner": string;
  }>;
  readonly binding: Readonly<{
    host: "127.0.0.1";
    hostPort: number;
    containerPort: 5432;
  }>;
  readonly storage: "tmpfs";
}

export type LiveDemoDatabaseContainerOwnershipIntent = Omit<LiveDemoDatabaseContainerProof, "id">;

export interface LiveDemoDatabaseProof {
  readonly databaseName: string;
  readonly databaseOwner: string;
  readonly provisioningOwnershipDigest: string;
  readonly attestationVersion: 1;
}

export interface LiveDemoDatabaseLifecycleState {
  readonly version: 1;
  readonly revision: number;
  readonly status: LiveDemoDatabaseLifecycleStatus;
  readonly checkpoint: LiveDemoDatabaseLifecycleCheckpoint;
  readonly session: LiveDemoDatabaseSessionProof;
  readonly containerIntent: LiveDemoDatabaseContainerOwnershipIntent;
  readonly container: LiveDemoDatabaseContainerProof | null;
  readonly database: LiveDemoDatabaseProof | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function invalidState(): never {
  throw new Error(INVALID_STATE_MESSAGE);
}

function parseSession(value: unknown): LiveDemoDatabaseSessionProof {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "createdAt"])) invalidState();
  const id = value["id"];
  const createdAt = value["createdAt"];
  if (
    typeof id !== "string" ||
    !sessionIdPattern.test(id) ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  ) {
    invalidState();
  }
  return Object.freeze({ id, createdAt });
}

function parseContainer(
  value: unknown,
  session: LiveDemoDatabaseSessionProof,
): LiveDemoDatabaseContainerProof {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "name", "image", "ownershipToken", "labels", "binding", "storage"])
  ) {
    invalidState();
  }
  const id = value["id"];
  const name = value["name"];
  const image = value["image"];
  const ownershipToken = value["ownershipToken"];
  const labels = value["labels"];
  const binding = value["binding"];
  const storage = value["storage"];
  if (
    typeof id !== "string" ||
    !containerIdPattern.test(id) ||
    name !== `muster-live-demo-database-${session.id}` ||
    image !== LIVE_DEMO_DATABASE_PINNED_IMAGE ||
    typeof ownershipToken !== "string" ||
    !ownershipTokenPattern.test(ownershipToken) ||
    !isRecord(labels) ||
    !hasExactKeys(labels, [
      "com.muster.live-demo-database.session",
      "com.muster.live-demo-database.owner",
    ]) ||
    labels["com.muster.live-demo-database.session"] !== session.id ||
    labels["com.muster.live-demo-database.owner"] !== ownershipToken ||
    !isRecord(binding) ||
    !hasExactKeys(binding, ["host", "hostPort", "containerPort"]) ||
    binding["host"] !== "127.0.0.1" ||
    !Number.isSafeInteger(binding["hostPort"]) ||
    (binding["hostPort"] as number) < 1 ||
    (binding["hostPort"] as number) > 65_535 ||
    binding["containerPort"] !== 5432 ||
    storage !== "tmpfs"
  ) {
    invalidState();
  }
  return Object.freeze({
    id,
    name,
    image,
    ownershipToken,
    labels: Object.freeze({
      "com.muster.live-demo-database.session": session.id,
      "com.muster.live-demo-database.owner": ownershipToken,
    }),
    binding: Object.freeze({
      host: "127.0.0.1" as const,
      hostPort: binding["hostPort"] as number,
      containerPort: 5432 as const,
    }),
    storage: "tmpfs" as const,
  });
}

function parseContainerIntent(
  value: unknown,
  session: LiveDemoDatabaseSessionProof,
): LiveDemoDatabaseContainerOwnershipIntent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["name", "image", "ownershipToken", "labels", "binding", "storage"])
  ) {
    invalidState();
  }
  const parsed = parseContainer({ id: "a".repeat(64), ...value }, session);
  return Object.freeze({
    name: parsed.name,
    image: parsed.image,
    ownershipToken: parsed.ownershipToken,
    labels: parsed.labels,
    binding: parsed.binding,
    storage: parsed.storage,
  });
}

function containerMatchesIntent(
  container: LiveDemoDatabaseContainerProof,
  intent: LiveDemoDatabaseContainerOwnershipIntent,
): boolean {
  const actual: LiveDemoDatabaseContainerOwnershipIntent = {
    name: container.name,
    image: container.image,
    ownershipToken: container.ownershipToken,
    labels: container.labels,
    binding: container.binding,
    storage: container.storage,
  };
  return sameProof(actual, intent);
}

function parseDatabase(value: unknown): LiveDemoDatabaseProof {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "databaseName",
      "databaseOwner",
      "provisioningOwnershipDigest",
      "attestationVersion",
    ])
  ) {
    invalidState();
  }
  const databaseName = value["databaseName"];
  const databaseOwner = value["databaseOwner"];
  const provisioningOwnershipDigest = value["provisioningOwnershipDigest"];
  if (
    typeof databaseName !== "string" ||
    !databaseNamePattern.test(databaseName) ||
    typeof databaseOwner !== "string" ||
    !databaseOwnerPattern.test(databaseOwner) ||
    typeof provisioningOwnershipDigest !== "string" ||
    !digestPattern.test(provisioningOwnershipDigest) ||
    value["attestationVersion"] !== 1
  ) {
    invalidState();
  }
  return Object.freeze({
    databaseName,
    databaseOwner,
    provisioningOwnershipDigest,
    attestationVersion: 1 as const,
  });
}

function proofsMatchCheckpoint(
  checkpoint: LiveDemoDatabaseLifecycleCheckpoint,
  container: LiveDemoDatabaseContainerProof | null,
  database: LiveDemoDatabaseProof | null,
): boolean {
  if (checkpoint === "state_created") return container === null && database === null;
  if (checkpoint === "container_created") return container !== null && database === null;
  if (checkpoint === "container_removed") return container !== null;
  return container !== null && database !== null;
}

function statusMatchesCheckpoint(
  status: LiveDemoDatabaseLifecycleStatus,
  checkpoint: LiveDemoDatabaseLifecycleCheckpoint,
): boolean {
  if (status === "starting") {
    return ["state_created", "container_created", "database_owned"].includes(checkpoint);
  }
  if (status === "ready") return checkpoint === "artifacts_published";
  return true;
}

export function parseLiveDemoDatabaseLifecycleState(
  value: unknown,
): LiveDemoDatabaseLifecycleState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "revision",
      "status",
      "checkpoint",
      "session",
      "containerIntent",
      "container",
      "database",
    ]) ||
    value["version"] !== 1 ||
    !Number.isSafeInteger(value["revision"]) ||
    (value["revision"] as number) < 0
  ) {
    invalidState();
  }
  const status = value["status"];
  const checkpoint = value["checkpoint"];
  if (
    typeof status !== "string" ||
    !["starting", "ready", "cleanup_required", "disposing"].includes(status) ||
    typeof checkpoint !== "string" ||
    ![
      "state_created",
      "container_created",
      "database_owned",
      "artifacts_published",
      "database_removed",
      "container_removed",
    ].includes(checkpoint)
  ) {
    invalidState();
  }
  const typedStatus = status as LiveDemoDatabaseLifecycleStatus;
  const typedCheckpoint = checkpoint as LiveDemoDatabaseLifecycleCheckpoint;
  const session = parseSession(value["session"]);
  const containerIntent = parseContainerIntent(value["containerIntent"], session);
  const container =
    value["container"] === null ? null : parseContainer(value["container"], session);
  const database = value["database"] === null ? null : parseDatabase(value["database"]);
  if (
    !proofsMatchCheckpoint(typedCheckpoint, container, database) ||
    !statusMatchesCheckpoint(typedStatus, typedCheckpoint) ||
    (container !== null && !containerMatchesIntent(container, containerIntent))
  ) {
    invalidState();
  }
  return Object.freeze({
    version: 1 as const,
    revision: value["revision"] as number,
    status: typedStatus,
    checkpoint: typedCheckpoint,
    session,
    containerIntent,
    container,
    database,
  });
}

export function serializeLiveDemoDatabaseLifecycleState(value: unknown): string {
  return `${JSON.stringify(parseLiveDemoDatabaseLifecycleState(value))}\n`;
}

export function createInitialLiveDemoDatabaseLifecycleState(input: {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly containerIntent: unknown;
}): LiveDemoDatabaseLifecycleState {
  return parseLiveDemoDatabaseLifecycleState({
    version: 1,
    revision: 0,
    status: "starting",
    checkpoint: "state_created",
    session: { id: input.sessionId, createdAt: input.createdAt },
    containerIntent: input.containerIntent,
    container: null,
    database: null,
  });
}

function sameProof(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLegalTransition(
  current: LiveDemoDatabaseLifecycleState,
  next: LiveDemoDatabaseLifecycleState,
): boolean {
  if (next.revision !== current.revision + 1 || !sameProof(next.session, current.session)) {
    return false;
  }
  if (!sameProof(next.containerIntent, current.containerIntent)) return false;
  if (current.container !== null && !sameProof(next.container, current.container)) return false;
  if (current.database !== null && !sameProof(next.database, current.database)) return false;
  const introducesContainerProof =
    current.container === null &&
    next.container !== null &&
    current.checkpoint === "state_created" &&
    next.checkpoint === "container_created" &&
    ((current.status === "starting" && next.status === "starting") ||
      (current.status === "disposing" && next.status === "disposing"));
  if (current.container === null && next.container !== null && !introducesContainerProof) {
    return false;
  }
  if (
    current.database === null &&
    next.database !== null &&
    !(
      current.status === "starting" &&
      current.checkpoint === "container_created" &&
      next.status === "starting" &&
      next.checkpoint === "database_owned"
    )
  ) {
    return false;
  }

  if (next.status === "cleanup_required" && next.checkpoint === current.checkpoint) return true;
  if (
    current.status === "cleanup_required" &&
    next.status === "disposing" &&
    next.checkpoint === current.checkpoint
  ) {
    return true;
  }
  if (
    current.status === "ready" &&
    next.status === "disposing" &&
    next.checkpoint === "artifacts_published"
  ) {
    return true;
  }
  if (introducesContainerProof) {
    return true;
  }
  if (
    current.status === "starting" &&
    current.checkpoint === "container_created" &&
    next.status === "starting" &&
    next.checkpoint === "database_owned" &&
    current.database === null &&
    next.database !== null
  ) {
    return true;
  }
  if (
    current.status === "starting" &&
    current.checkpoint === "database_owned" &&
    next.status === "ready" &&
    next.checkpoint === "artifacts_published"
  ) {
    return true;
  }
  if (current.status !== "disposing" || next.status !== "disposing") return false;
  if (current.checkpoint === "container_created" && next.checkpoint === "container_removed") {
    return true;
  }
  if (
    (current.checkpoint === "database_owned" || current.checkpoint === "artifacts_published") &&
    next.checkpoint === "database_removed"
  ) {
    return true;
  }
  return current.checkpoint === "database_removed" && next.checkpoint === "container_removed";
}

export function transitionLiveDemoDatabaseLifecycleState(
  currentValue: unknown,
  update: Readonly<{
    status: LiveDemoDatabaseLifecycleStatus;
    checkpoint: LiveDemoDatabaseLifecycleCheckpoint;
    container?: unknown;
    database?: unknown;
  }>,
): LiveDemoDatabaseLifecycleState {
  let current: LiveDemoDatabaseLifecycleState;
  let next: LiveDemoDatabaseLifecycleState;
  try {
    current = parseLiveDemoDatabaseLifecycleState(currentValue);
    next = parseLiveDemoDatabaseLifecycleState({
      version: 1,
      revision: current.revision + 1,
      status: update.status,
      checkpoint: update.checkpoint,
      session: current.session,
      containerIntent: current.containerIntent,
      container: update.container === undefined ? current.container : update.container,
      database: update.database === undefined ? current.database : update.database,
    });
  } catch {
    throw new Error(INVALID_TRANSITION_MESSAGE);
  }
  if (!isLegalTransition(current, next)) throw new Error(INVALID_TRANSITION_MESSAGE);
  return next;
}

export function assertLiveDemoDatabaseLifecycleTransition(
  currentValue: unknown,
  nextValue: unknown,
): Readonly<{
  current: LiveDemoDatabaseLifecycleState;
  next: LiveDemoDatabaseLifecycleState;
}> {
  let current: LiveDemoDatabaseLifecycleState;
  let next: LiveDemoDatabaseLifecycleState;
  try {
    current = parseLiveDemoDatabaseLifecycleState(currentValue);
    next = parseLiveDemoDatabaseLifecycleState(nextValue);
  } catch {
    throw new Error(INVALID_TRANSITION_MESSAGE);
  }
  if (!isLegalTransition(current, next)) throw new Error(INVALID_TRANSITION_MESSAGE);
  return Object.freeze({ current, next });
}

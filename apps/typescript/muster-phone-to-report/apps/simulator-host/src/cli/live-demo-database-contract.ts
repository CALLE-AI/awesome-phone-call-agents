import path from "node:path";

export const LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE = "Disposable live-demo database ready.";
export const LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE = "Disposable live-demo database disposed.";
export const LIVE_DEMO_DATABASE_ATTENTION_MESSAGE =
  "Disposable live-demo database requires attention; protected recovery state was retained.";
export const LIVE_DEMO_DATABASE_USAGE_MESSAGE = "Usage: live-demo-database <start|dispose>";

export type LiveDemoDatabaseCommand = "start" | "dispose";

export interface LiveDemoDatabasePaths {
  readonly root: string;
  readonly databaseUrl: string;
  readonly provisioningAttestation: string;
  readonly activationScript: string;
  readonly lifecycleState: string;
}

export function parseLiveDemoDatabaseCommand(
  arguments_: readonly string[],
): LiveDemoDatabaseCommand {
  if (arguments_.length !== 1 || (arguments_[0] !== "start" && arguments_[0] !== "dispose")) {
    throw new Error(LIVE_DEMO_DATABASE_USAGE_MESSAGE);
  }
  return arguments_[0];
}

export function createLiveDemoDatabasePaths(repositoryRoot: string): LiveDemoDatabasePaths {
  if (
    !path.isAbsolute(repositoryRoot) ||
    repositoryRoot.includes("\0") ||
    repositoryRoot.includes("\r") ||
    repositoryRoot.includes("\n")
  ) {
    throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  }
  const root = path.join(repositoryRoot, ".generated-tmp", "live-demo-database");
  return Object.freeze({
    root,
    databaseUrl: path.join(root, "database-url.txt"),
    provisioningAttestation: path.join(root, "provisioning-attestation.json"),
    activationScript: path.join(root, "activate.ps1"),
    lifecycleState: path.join(root, "lifecycle-state.json"),
  });
}

export function liveDemoDatabaseStartOutput(paths: LiveDemoDatabasePaths): readonly string[] {
  let expectedPaths: LiveDemoDatabasePaths;
  try {
    const repositoryRoot = path.dirname(path.dirname(paths.root));
    expectedPaths = createLiveDemoDatabasePaths(repositoryRoot);
  } catch {
    return liveDemoDatabaseAttentionOutput();
  }
  if (
    paths.root !== expectedPaths.root ||
    paths.databaseUrl !== expectedPaths.databaseUrl ||
    paths.provisioningAttestation !== expectedPaths.provisioningAttestation ||
    paths.activationScript !== expectedPaths.activationScript ||
    paths.lifecycleState !== expectedPaths.lifecycleState
  ) {
    return liveDemoDatabaseAttentionOutput();
  }
  return Object.freeze([LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE, paths.activationScript]);
}

export function liveDemoDatabaseDisposeOutput(): readonly string[] {
  return Object.freeze([LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE]);
}

export function liveDemoDatabaseAttentionOutput(): readonly string[] {
  return Object.freeze([LIVE_DEMO_DATABASE_ATTENTION_MESSAGE]);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function validActivationDatabaseUrl(databaseUrl: string): boolean {
  if (/[\0\r\n]/u.test(databaseUrl)) return false;
  try {
    const parsed = new URL(databaseUrl);
    return (
      (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
      parsed.username.length > 0 &&
      parsed.password.length > 0 &&
      isLoopbackHost(parsed.hostname) &&
      parsed.port.length > 0 &&
      Number(parsed.port) >= 1 &&
      Number(parsed.port) <= 65_535 &&
      parsed.pathname.length > 1 &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
}

function powerShellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function createLiveDemoDatabasePowerShellActivation(input: {
  readonly databaseUrl: string;
  readonly attestationFilePath: string;
}): string {
  if (
    !validActivationDatabaseUrl(input.databaseUrl) ||
    !path.isAbsolute(input.attestationFilePath) ||
    /[\0\r\n]/u.test(input.attestationFilePath)
  ) {
    throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  }
  const databaseUrl = powerShellSingleQuoted(input.databaseUrl);
  const attestationFilePath = powerShellSingleQuoted(input.attestationFilePath);
  return [
    `$env:DATABASE_URL = ${databaseUrl}`,
    `$env:MIGRATION_DATABASE_URL = ${databaseUrl}`,
    `$env:LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE = ${attestationFilePath}`,
    "",
  ].join("\n");
}

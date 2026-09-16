import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  createLiveDemoDatabasePaths,
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
} from "../cli/live-demo-database-contract.js";
import type { LiveDemoDatabaseDisposeCapabilities } from "../cli/live-demo-database-dispose.js";
import type {
  LiveDemoDatabaseArtifactPublication,
  LiveDemoDatabaseStatePublication,
} from "../cli/live-demo-database-lifecycle.js";
import {
  defaultLiveDemoDatabaseStartIdentityCapabilities,
  type LiveDemoDatabaseProcessRequest,
  type LiveDemoDatabaseProcessResult,
  type LiveDemoDatabaseStartCapabilities,
} from "../cli/live-demo-database-start.js";
import { liveDemoDatabaseDisposeOwnershipCapabilities } from "./live-demo-database-dispose-ownership.js";
import { liveDemoDatabaseStartOwnershipCapabilities } from "./live-demo-database-start-ownership.js";

const maximumCapturedBytes = 1024 * 1024;
const childTerminationEscalationMs = 2_000;
const stateLockName = "lifecycle-state.lock";
const stageMarker = ".muster-stage-";

interface StagedArtifacts {
  readonly entries: readonly Readonly<{ finalPath: string; temporaryPath: string }>[];
}

export interface LiveDemoDatabaseOperatorRuntime {
  readonly start: LiveDemoDatabaseStartCapabilities;
  readonly dispose: LiveDemoDatabaseDisposeCapabilities;
}

export async function awaitLiveDemoDatabaseChildExit(
  child: Pick<ChildProcess, "kill" | "off" | "on" | "once">,
  timeoutMs: number,
): Promise<Readonly<{ exitCode: number; timedOut: boolean }>> {
  return await new Promise((resolve, reject) => {
    let timedOut = false;
    let childError: Error | undefined;
    let escalation: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      escalation = setTimeout(() => {
        child.kill("SIGKILL");
      }, childTerminationEscalationMs);
      escalation.unref();
    }, timeoutMs);
    timeout.unref();
    const recordChildError = (error: Error): void => {
      childError ??= error;
    };
    child.on("error", recordChildError);
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (escalation !== undefined) clearTimeout(escalation);
      child.off("error", recordChildError);
      if (childError !== undefined) {
        reject(childError);
        return;
      }
      resolve(Object.freeze({ exitCode: timedOut ? 1 : (code ?? 1), timedOut }));
    });
  });
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function safeChildEnvironment(
  extra: Readonly<Record<string, string>>,
  docker: boolean,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of [
    ["COMSPEC", process.env["COMSPEC"]],
    ["PATH", process.env["PATH"]],
    ["PATHEXT", process.env["PATHEXT"]],
    ["SYSTEMDRIVE", process.env["SYSTEMDRIVE"]],
    ["SYSTEMROOT", process.env["SYSTEMROOT"]],
    ["TEMP", process.env["TEMP"]],
    ["TMP", process.env["TMP"]],
    ["WINDIR", process.env["WINDIR"]],
  ] as const) {
    if (value !== undefined) environment[name] = value;
  }
  if (docker) {
    environment["DOCKER_HOST"] =
      process.platform === "win32"
        ? "npipe:////./pipe/docker_engine"
        : "unix:///var/run/docker.sock";
  }
  for (const [name, value] of Object.entries(extra)) environment[name] = value;
  return environment;
}

async function runSuppressedProcess(
  request: LiveDemoDatabaseProcessRequest,
): Promise<LiveDemoDatabaseProcessResult> {
  const isDocker = request.executable === "docker";
  if (!isDocker && path.resolve(request.executable) !== path.resolve(process.execPath)) {
    throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  }
  return await new Promise((resolve, reject) => {
    const capture = request.output === "capture_suppressed";
    const child = spawn(request.executable, [...request.arguments], {
      cwd: request.cwd,
      env: safeChildEnvironment(request.environment, isDocker),
      windowsHide: true,
      stdio: [
        request.standardInput === undefined ? "ignore" : "pipe",
        capture ? "pipe" : "ignore",
        "ignore",
      ],
    });
    let stdout = "";
    if (capture && child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (Buffer.byteLength(stdout, "utf8") >= maximumCapturedBytes) return;
        stdout += chunk;
        if (Buffer.byteLength(stdout, "utf8") > maximumCapturedBytes) {
          stdout = stdout.slice(0, maximumCapturedBytes);
          child.kill();
        }
      });
    }
    if (request.standardInput !== undefined && child.stdin !== null) {
      child.stdin.end(request.standardInput);
    }
    void awaitLiveDemoDatabaseChildExit(child, request.timeoutMs).then(
      ({ exitCode, timedOut }) =>
        resolve(Object.freeze({ exitCode, stdout: timedOut ? "" : stdout })),
      reject,
    );
  });
}

async function runWindowsAclScript(script: string, protectedPath: string): Promise<boolean> {
  const systemRoot = process.env["SYSTEMROOT"] ?? process.env["WINDIR"];
  if (systemRoot === undefined || !path.isAbsolute(systemRoot)) return false;
  const executable = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return await new Promise((resolve) => {
    const child = spawn(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: safeChildEnvironment({ MUSTER_PROTECTED_PATH: protectedPath }, false),
        windowsHide: true,
        stdio: "ignore",
      },
    );
    void awaitLiveDemoDatabaseChildExit(child, 5_000).then(
      ({ exitCode, timedOut }) => resolve(!timedOut && exitCode === 0),
      () => resolve(false),
    );
  });
}

const protectWindowsFileScript = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:MUSTER_PROTECTED_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
& icacls.exe $target /inheritance:r /grant:r ('*' + $sid.Value + ':F') | Out-Null
if ($LASTEXITCODE -ne 0) { exit 1 }
`;

const protectWindowsDirectoryScript = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:MUSTER_PROTECTED_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
& icacls.exe $target /inheritance:r /grant:r ('*' + $sid.Value + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { exit 1 }
`;

const verifyWindowsAclScript = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:MUSTER_PROTECTED_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $target
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
if ($owner.Value -ne $sid.Value -or $rules.Count -ne 1) { exit 1 }
$rule = $rules[0]
if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.IsInherited -or $rule.AccessControlType -ne 'Allow') { exit 1 }
exit 0
`;

async function protectOwnerOnly(protectedPath: string, directory: boolean): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      return await runWindowsAclScript(
        directory ? protectWindowsDirectoryScript : protectWindowsFileScript,
        protectedPath,
      );
    }
    await chmod(protectedPath, directory ? 0o700 : 0o600);
    return true;
  } catch {
    return false;
  }
}

async function verifyOwnerOnly(protectedPath: string, directory = false): Promise<boolean> {
  try {
    const metadata = await lstat(protectedPath);
    if (directory ? !metadata.isDirectory() : !metadata.isFile() || metadata.isSymbolicLink()) {
      return false;
    }
    if (process.platform === "win32") {
      return await runWindowsAclScript(verifyWindowsAclScript, protectedPath);
    }
    return (metadata.mode & (directory ? 0o077 : 0o177)) === 0;
  } catch {
    return false;
  }
}

async function writeOwnerOnlyExclusive(filePath: string, contents: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    if (errno(error) === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
  return await protectOwnerOnly(filePath, false);
}

async function readOwnerOnly(filePath: string, maximumBytes: number): Promise<string | undefined> {
  if (!(await verifyOwnerOnly(filePath))) return undefined;
  const metadata = await stat(filePath);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || metadata.size > maximumBytes) {
    return undefined;
  }
  return await readFile(filePath, "utf8");
}

function assertWithinRoot(root: string, candidate: string): void {
  const resolved = path.resolve(candidate);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  }
}

async function removeFileWithin(root: string, filePath: string): Promise<boolean> {
  assertWithinRoot(root, filePath);
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    await rm(filePath, { force: false });
    return true;
  } catch (error) {
    return errno(error) === "ENOENT";
  }
}

export function createLiveDemoDatabaseOperatorRuntime(
  repositoryRoot: string,
): LiveDemoDatabaseOperatorRuntime {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  if (!path.isAbsolute(repositoryRoot) || /[\0\r\n]/u.test(repositoryRoot)) {
    throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  }
  const paths = createLiveDemoDatabasePaths(resolvedRepositoryRoot);
  const root = paths.root;
  const lockPath = path.join(root, stateLockName);

  const ensureProtectedRoot = async (): Promise<boolean> => {
    try {
      await mkdir(path.dirname(root), { recursive: true });
      try {
        await mkdir(root, { mode: 0o700 });
      } catch (error) {
        if (errno(error) !== "EEXIST") throw error;
        if (!(await verifyOwnerOnly(root, true))) return false;
      }
      return (await protectOwnerOnly(root, true)) && (await verifyOwnerOnly(root, true));
    } catch {
      return false;
    }
  };

  const withStateLock = async <T>(operation: () => Promise<T>, blocked: T): Promise<T> => {
    if (!(await writeOwnerOnlyExclusive(lockPath, "locked\n"))) return blocked;
    try {
      if (!(await verifyOwnerOnly(lockPath))) return blocked;
      return await operation();
    } finally {
      await removeFileWithin(root, lockPath).catch(() => false);
    }
  };

  const statePublication: LiveDemoDatabaseStatePublication = Object.freeze({
    async createExclusive(serializedState: string): Promise<boolean> {
      if (!(await ensureProtectedRoot())) return false;
      const existing = await readdir(root);
      if (existing.length !== 0) return false;
      return await writeOwnerOnlyExclusive(paths.lifecycleState, serializedState);
    },
    async replaceAtomically(input: {
      readonly expectedSerializedState: string;
      readonly nextSerializedState: string;
    }): Promise<boolean> {
      if (!(await verifyOwnerOnly(root, true))) return false;
      return await withStateLock(async () => {
        const current = await readOwnerOnly(paths.lifecycleState, 16 * 1024);
        if (current !== input.expectedSerializedState) return false;
        const temporaryPath = `${paths.lifecycleState}.${randomUUID()}.tmp`;
        assertWithinRoot(root, temporaryPath);
        try {
          if (!(await writeOwnerOnlyExclusive(temporaryPath, input.nextSerializedState))) {
            return false;
          }
          if (!(await verifyOwnerOnly(temporaryPath))) return false;
          await rename(temporaryPath, paths.lifecycleState);
          return await verifyOwnerOnly(paths.lifecycleState);
        } finally {
          await removeFileWithin(root, temporaryPath).catch(() => false);
        }
      }, false);
    },
  });

  const stage = async (
    artifacts: readonly Readonly<{ path: string; contents: string }>[],
  ): Promise<StagedArtifacts> => {
    const expected = new Set([
      paths.databaseUrl,
      paths.provisioningAttestation,
      paths.activationScript,
    ]);
    if (
      artifacts.length !== expected.size ||
      artifacts.some((artifact) => !expected.delete(artifact.path))
    ) {
      throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    }
    const entries: Array<{ finalPath: string; temporaryPath: string }> = [];
    try {
      for (const artifact of artifacts) {
        assertWithinRoot(root, artifact.path);
        const temporaryPath = `${artifact.path}${stageMarker}${randomUUID()}`;
        assertWithinRoot(root, temporaryPath);
        if (!(await writeOwnerOnlyExclusive(temporaryPath, artifact.contents))) {
          throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
        }
        entries.push({ finalPath: artifact.path, temporaryPath });
      }
      return Object.freeze({
        entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
      });
    } catch (error) {
      await Promise.all(entries.map(({ temporaryPath }) => removeFileWithin(root, temporaryPath)));
      throw error;
    }
  };

  const artifactPublication: LiveDemoDatabaseArtifactPublication<StagedArtifacts> = Object.freeze({
    stage,
    async setOwnerOnlyPermissions(staged: StagedArtifacts): Promise<void> {
      for (const { temporaryPath } of staged.entries) {
        if (!(await protectOwnerOnly(temporaryPath, false))) {
          throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
        }
      }
    },
    async verifyOwnerOnlyPermissions(staged: StagedArtifacts): Promise<boolean> {
      for (const { temporaryPath } of staged.entries) {
        if (!(await verifyOwnerOnly(temporaryPath))) return false;
      }
      return true;
    },
    async publishAtomically(staged: StagedArtifacts): Promise<void> {
      for (const { finalPath, temporaryPath } of staged.entries) {
        await link(temporaryPath, finalPath);
        await rm(temporaryPath, { force: false });
        if (!(await verifyOwnerOnly(finalPath))) {
          throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
        }
      }
    },
    async discard(staged: StagedArtifacts): Promise<void> {
      for (const { temporaryPath } of staged.entries) {
        if (!(await removeFileWithin(root, temporaryPath))) {
          throw new Error(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
        }
      }
    },
  });

  const commonProtectedFiles = Object.freeze({
    async verifyOwnerOnly(filePath: string): Promise<boolean> {
      assertWithinRoot(root, filePath);
      return await verifyOwnerOnly(filePath);
    },
    async readOwnerOnly(filePath: string, maximumBytes: number): Promise<string | undefined> {
      assertWithinRoot(root, filePath);
      return await readOwnerOnly(filePath, maximumBytes);
    },
    async removeWithin(filePath: string, _timeoutMs: number): Promise<boolean> {
      void _timeoutMs;
      return await removeFileWithin(root, filePath);
    },
  });

  const wait = async (milliseconds: number): Promise<void> =>
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  const start: LiveDemoDatabaseStartCapabilities = Object.freeze({
    identity: defaultLiveDemoDatabaseStartIdentityCapabilities,
    process: Object.freeze({ run: runSuppressedProcess }),
    wait,
    protectedFiles: Object.freeze({
      async createOwnerOnlyExclusive(input: {
        readonly path: string;
        readonly contents: string;
      }): Promise<boolean> {
        assertWithinRoot(root, input.path);
        if (!(await verifyOwnerOnly(root, true))) return false;
        return await writeOwnerOnlyExclusive(input.path, input.contents);
      },
      async protectExisting(filePath: string): Promise<boolean> {
        assertWithinRoot(root, filePath);
        return await protectOwnerOnly(filePath, false);
      },
      ...commonProtectedFiles,
    }),
    statePublication,
    artifactPublication,
    ownership: liveDemoDatabaseStartOwnershipCapabilities,
  });

  const dispose: LiveDemoDatabaseDisposeCapabilities = Object.freeze({
    process: start.process,
    wait,
    state: Object.freeze({
      ...statePublication,
      async loadOwnerOnly(maximumBytes: number): Promise<string | undefined> {
        if (!(await verifyOwnerOnly(root, true))) return undefined;
        return await readOwnerOnly(paths.lifecycleState, maximumBytes);
      },
      async removeExact(expectedSerializedState: string): Promise<boolean> {
        if (!(await verifyOwnerOnly(root, true))) return false;
        return await withStateLock(async () => {
          const current = await readOwnerOnly(paths.lifecycleState, 16 * 1024);
          if (current !== expectedSerializedState) return false;
          const entries = await readdir(root);
          if (
            entries.some(
              (name) => name !== path.basename(paths.lifecycleState) && name !== stateLockName,
            )
          ) {
            return false;
          }
          return await removeFileWithin(root, paths.lifecycleState);
        }, false);
      },
    }),
    artifacts: commonProtectedFiles,
    ownership: liveDemoDatabaseDisposeOwnershipCapabilities,
    closeConnections: async () => undefined,
  });

  return Object.freeze({ start, dispose });
}

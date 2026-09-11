import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  LIVE_DEMO_READINESS_CHECK_IDS,
  computeLiveDemoWorktreeDigest,
  readRepositoryHead,
  type LiveDemoReadinessCheckId,
} from "./verify-live-demo-readiness.ts";

const requiredTests = Object.freeze({
  "disposable-local-composition":
    "composes disposable PostgreSQL, pg-boss, host, and bounded client through loopback only",
  "independent-oracle-anti-stub":
    "uses an independent oracle to prove input-distinct provider evidence is not a fixture stub",
  "production-artifact-exclusion":
    "rejects a simulator import mutation and proves a fresh production artifact is clean",
  "abnormal-recovery-lineage":
    "persists exact abnormal-to-recovery lineage across separate one-use runtimes",
  "deterministic-replay-fallback":
    "keeps replay dependable and scopes the successful CALL-E-to-Twilio synthetic evidence",
  "demo-submission-artifacts":
    "keeps submission drafts local and traces the current official requirements",
} satisfies Readonly<Record<LiveDemoReadinessCheckId, string>>);

function safeEnvironment(preloadPath: string): NodeJS.ProcessEnv {
  // Rebuild the child environment from a small process/toolchain allowlist so
  // ambient provider credentials cannot enter the readiness proof.
  const allowed: NodeJS.ProcessEnv = {};
  const copy = (name: string, value: string | undefined): void => {
    if (value !== undefined) allowed[name] = value;
  };
  copy("CI", process.env["CI"]);
  copy("COMSPEC", process.env["COMSPEC"]);
  copy("PATH", process.env["PATH"]);
  copy("PATHEXT", process.env["PATHEXT"]);
  copy("SYSTEMDRIVE", process.env["SYSTEMDRIVE"]);
  copy("SYSTEMROOT", process.env["SYSTEMROOT"]);
  copy("TEMP", process.env["TEMP"]);
  copy("TMP", process.env["TMP"]);
  copy("WINDIR", process.env["WINDIR"]);
  allowed["NODE_OPTIONS"] = `--import=${pathToFileURL(preloadPath).href}`;
  allowed["MUSTER_LIVE_DEMO_READINESS"] = "1";
  return allowed;
}

async function run(input: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.environment,
      windowsHide: true,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => {
      stdout += value;
    });
    child.stderr.on("data", (value: string) => {
      stderr += value;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

interface VitestJsonReport {
  readonly testResults?: readonly Readonly<{
    assertionResults?: readonly Readonly<{
      fullName?: string;
      status?: string;
    }>[];
  }>[];
}

function machineChecks(report: VitestJsonReport) {
  const assertions = (report.testResults ?? []).flatMap((result) => result.assertionResults ?? []);
  return LIVE_DEMO_READINESS_CHECK_IDS.map((id) => {
    const title = requiredTests[id];
    const assertion = assertions.find(({ fullName }) => fullName?.endsWith(title) === true);
    const status =
      assertion?.status === "passed"
        ? "passed"
        : assertion?.status === "failed"
          ? "failed"
          : assertion === undefined
            ? "missing"
            : "skipped";
    return Object.freeze({ id, status, testName: assertion?.fullName ?? title });
  });
}

export async function recordLiveDemoReadiness(repositoryRoot: string): Promise<boolean> {
  const root = path.resolve(repositoryRoot);
  const actualNodeVersion = process.version.replace(/^v/u, "");
  const outputDirectory = path.join(root, ".generated-tmp");
  const reportPath = path.join(outputDirectory, "live-demo-readiness-vitest.json");
  const evidencePath = path.join(outputDirectory, "live-demo-readiness.json");
  const preloadPath = path.join(root, "tools/simulator/loopback-only-network-preload.mjs");
  await mkdir(outputDirectory, { recursive: true });
  const environment = safeEnvironment(preloadPath);
  const corepackExecutable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const pnpm = await run({
    executable: corepackExecutable,
    args:
      process.platform === "win32"
        ? ["/d", "/s", "/c", "corepack.cmd pnpm --version"]
        : ["pnpm", "--version"],
    cwd: root,
    environment,
  });
  const pnpmVersion = pnpm.code === 0 ? pnpm.stdout.trim() : "unavailable";
  const vitest = await run({
    executable: process.execPath,
    args: [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/e2e/hackathon-live-calle-observation.integration.test.ts",
      "tools/architecture/simulator-production-boundary.test.ts",
      "tools/architecture/live-demo-readiness-isolation.test.ts",
      "tools/simulator/live-demo-handoff.test.ts",
      "--config",
      "vitest.workspace.ts",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    cwd: root,
    environment,
  });
  const report = await readFile(reportPath, "utf8")
    .then((value) => JSON.parse(value) as VitestJsonReport)
    .catch(() => ({}));
  const checks = machineChecks(report);
  const evidence = Object.freeze({
    schemaVersion: "live-demo-readiness.v1",
    repositoryHead: await readRepositoryHead(root),
    worktreeDigest: await computeLiveDemoWorktreeDigest(root),
    nodeVersion: actualNodeVersion,
    pnpmVersion,
    generatedAt: new Date().toISOString(),
    checks,
  });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const ready =
    actualNodeVersion === "24.18.0" &&
    pnpmVersion === "11.20.0" &&
    vitest.code === 0 &&
    checks.every(({ status }) => status === "passed");
  if (!ready) {
    process.stderr.write(vitest.stderr.slice(0, 4_096));
  }
  return ready;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  if (!(await recordLiveDemoReadiness(process.cwd()))) process.exitCode = 1;
}

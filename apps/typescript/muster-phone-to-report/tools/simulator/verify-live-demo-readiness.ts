import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";

export const LIVE_DEMO_READINESS_CHECK_IDS = Object.freeze([
  "disposable-local-composition",
  "independent-oracle-anti-stub",
  "production-artifact-exclusion",
  "abnormal-recovery-lineage",
  "deterministic-replay-fallback",
  "demo-submission-artifacts",
] as const);

export type LiveDemoReadinessCheckId = (typeof LIVE_DEMO_READINESS_CHECK_IDS)[number];

type MachineCheckStatus = "passed" | "failed" | "skipped" | "missing";

interface LiveDemoReadinessEvidence {
  readonly schemaVersion: "live-demo-readiness.v1";
  readonly repositoryHead: string;
  readonly worktreeDigest: string;
  readonly nodeVersion: string;
  readonly pnpmVersion: string;
  readonly generatedAt: string;
  readonly checks: readonly Readonly<{
    id: LiveDemoReadinessCheckId;
    status: MachineCheckStatus;
    testName: string;
  }>[];
}

export interface LiveDemoReadinessResult {
  readonly evidenceClass: "LOCAL_PROVIDER_FREE";
  readonly replayReady: boolean;
  /** Compatibility alias for replayReady. */
  readonly ready: boolean;
  readonly liveReadiness: "NOT_ASSESSED";
  readonly authorizesCall: false;
  readonly callAuthorization: "NONE";
  readonly runGate: "CLOSED";
  readonly reason: "ready" | "evidence_missing_or_invalid" | "evidence_stale_or_failed";
  readonly checks: readonly Readonly<{
    id: LiveDemoReadinessCheckId;
    ready: boolean;
    evidence: string;
  }>[];
  readonly prohibitedCapabilities: readonly string[];
}

const excludedDirectoryNames = new Set([
  ".cache",
  ".claude-logs",
  ".generated-tmp",
  ".git",
  ".local",
  ".local-evidence",
  ".next",
  ".otel",
  ".pnpm-store",
  ".telemetry",
  ".test-logs",
  ".turbo",
  ".vite",
  ".worktrees",
  ".auth",
  ".build",
  "build",
  "coverage",
  "dist",
  "dist-demo",
  "dist-types",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
]);
const excludedSensitiveFileNames = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".yarnrc",
  "credentials",
  "credentials.json",
  "secrets.json",
]);

const shaPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const maximumEvidenceAgeMs = 30 * 60 * 1_000;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvidence(value: unknown): LiveDemoReadinessEvidence | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== "live-demo-readiness.v1") return undefined;
  const checks = value["checks"];
  if (
    typeof value["repositoryHead"] !== "string" ||
    !shaPattern.test(value["repositoryHead"]) ||
    typeof value["worktreeDigest"] !== "string" ||
    !digestPattern.test(value["worktreeDigest"]) ||
    typeof value["nodeVersion"] !== "string" ||
    typeof value["pnpmVersion"] !== "string" ||
    typeof value["generatedAt"] !== "string" ||
    !Array.isArray(checks) ||
    checks.length !== LIVE_DEMO_READINESS_CHECK_IDS.length
  ) {
    return undefined;
  }
  const parsedChecks = checks.flatMap((candidate): LiveDemoReadinessEvidence["checks"] => {
    if (!isRecord(candidate)) return [];
    const id = candidate["id"];
    const status = candidate["status"];
    const testName = candidate["testName"];
    if (
      typeof id !== "string" ||
      !LIVE_DEMO_READINESS_CHECK_IDS.includes(id as LiveDemoReadinessCheckId) ||
      (status !== "passed" &&
        status !== "failed" &&
        status !== "skipped" &&
        status !== "missing") ||
      typeof testName !== "string" ||
      testName.length < 1 ||
      testName.length > 256
    ) {
      return [];
    }
    return [{ id: id as LiveDemoReadinessCheckId, status, testName }];
  });
  if (
    parsedChecks.length !== checks.length ||
    new Set(parsedChecks.map(({ id }) => id)).size !== LIVE_DEMO_READINESS_CHECK_IDS.length
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: "live-demo-readiness.v1",
    repositoryHead: value["repositoryHead"],
    worktreeDigest: value["worktreeDigest"],
    nodeVersion: value["nodeVersion"],
    pnpmVersion: value["pnpmVersion"],
    generatedAt: value["generatedAt"],
    checks: Object.freeze(parsedChecks),
  });
}

export async function computeLiveDemoWorktreeDigest(repositoryRoot: string): Promise<string> {
  const root = path.resolve(repositoryRoot);
  const digest = createHash("sha256");
  const addEntry = (kind: "file" | "link", relativePath: string, content: Buffer | string) => {
    const byteLength = Buffer.isBuffer(content) ? content.byteLength : Buffer.byteLength(content);
    digest.update(kind, "utf8");
    digest.update("\0", "utf8");
    digest.update(relativePath.replaceAll(path.sep, "/"), "utf8");
    digest.update("\0", "utf8");
    digest.update(String(byteLength), "utf8");
    digest.update("\0", "utf8");
    digest.update(content);
    digest.update("\0", "utf8");
  };
  const excludedFile = (name: string): boolean => {
    const lowerName = name.toLowerCase();
    if (lowerName === ".git" || excludedSensitiveFileNames.has(lowerName)) return true;
    if (
      lowerName.startsWith(".env.") &&
      lowerName !== ".env.example" &&
      lowerName !== ".env.sample" &&
      lowerName !== ".env.template"
    ) {
      return true;
    }
    return (
      lowerName.endsWith(".log") ||
      lowerName.endsWith(".sqlite") ||
      lowerName.endsWith(".sqlite3") ||
      lowerName.endsWith(".tsbuildinfo")
    );
  };
  const excludedRelativeDirectory = (relativePath: string): boolean => {
    const canonical = relativePath.replaceAll(path.sep, "/").toLowerCase();
    return (
      canonical === "evidence/grounded-reading-extraction" ||
      canonical === "memory-bank/uat/artifacts"
    );
  };
  // Protected captures are excluded by path before file contents are opened;
  // readiness evidence must neither consume secrets nor self-invalidate.
  const excludedProtectedProviderCapture = (relativePath: string): boolean => {
    const canonical = relativePath.replaceAll(path.sep, "/").toLowerCase();
    if (!canonical.startsWith("tests/fixtures/providers/calle/grounded-reading/")) return false;
    const name = path.posix.basename(canonical);
    return (
      name.includes(".unredacted.") ||
      name.includes(".local.") ||
      name.startsWith("provider-capture-") ||
      name.includes(".recording.") ||
      name.includes(".transcript.")
    );
  };
  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (
          !excludedDirectoryNames.has(entry.name.toLowerCase()) &&
          !excludedRelativeDirectory(relativePath)
        ) {
          await visit(relativePath);
        }
      } else if (entry.isSymbolicLink()) {
        if (!excludedFile(entry.name) && !excludedProtectedProviderCapture(relativePath)) {
          addEntry("link", relativePath, await readlink(path.join(root, relativePath)));
        }
      } else if (
        entry.isFile() &&
        !excludedFile(entry.name) &&
        !excludedProtectedProviderCapture(relativePath)
      ) {
        addEntry("file", relativePath, await readFile(path.join(root, relativePath)));
      }
    }
  };
  await visit("");
  return digest.digest("hex");
}

function failedResult(reason: LiveDemoReadinessResult["reason"]): LiveDemoReadinessResult {
  const replayReady = false;
  return Object.freeze({
    evidenceClass: "LOCAL_PROVIDER_FREE",
    replayReady,
    ready: replayReady,
    liveReadiness: "NOT_ASSESSED",
    authorizesCall: false,
    callAuthorization: "NONE",
    runGate: "CLOSED",
    reason,
    checks: Object.freeze(
      LIVE_DEMO_READINESS_CHECK_IDS.map((id) =>
        Object.freeze({ id, ready: false, evidence: "machine evidence unavailable" }),
      ),
    ),
    prohibitedCapabilities: Object.freeze([]),
  });
}

export async function verifyLiveDemoReadiness(input: {
  readonly repositoryRoot: string;
  readonly evidence: unknown;
  readonly repositoryHead: string;
  readonly now: Date;
  readonly currentNodeVersion?: string;
}): Promise<LiveDemoReadinessResult> {
  const evidence = parseEvidence(input.evidence);
  if (evidence === undefined) return failedResult("evidence_missing_or_invalid");
  const currentDigest = await computeLiveDemoWorktreeDigest(path.resolve(input.repositoryRoot));
  const generatedAt = Date.parse(evidence.generatedAt);
  const currentNodeVersion = input.currentNodeVersion ?? evidence.nodeVersion;
  const stale =
    evidence.repositoryHead !== input.repositoryHead ||
    evidence.worktreeDigest !== currentDigest ||
    evidence.nodeVersion !== "24.18.0" ||
    currentNodeVersion !== "24.18.0" ||
    evidence.pnpmVersion !== "11.20.0" ||
    !Number.isFinite(generatedAt) ||
    generatedAt > input.now.getTime() ||
    input.now.getTime() - generatedAt > maximumEvidenceAgeMs;
  const checks = Object.freeze(
    LIVE_DEMO_READINESS_CHECK_IDS.map((id) => {
      const machineCheck = evidence.checks.find((candidate) => candidate.id === id);
      return Object.freeze({
        id,
        ready: !stale && machineCheck?.status === "passed",
        evidence: machineCheck?.testName ?? "machine evidence unavailable",
      });
    }),
  );
  const replayReady = !stale && checks.every((candidate) => candidate.ready);
  return Object.freeze({
    evidenceClass: "LOCAL_PROVIDER_FREE",
    replayReady,
    ready: replayReady,
    liveReadiness: "NOT_ASSESSED",
    authorizesCall: false,
    callAuthorization: "NONE",
    runGate: "CLOSED",
    reason: replayReady ? "ready" : "evidence_stale_or_failed",
    checks,
    prohibitedCapabilities: Object.freeze([]),
  });
}

async function gitDirectory(repositoryRoot: string): Promise<string> {
  const dotGit = path.join(repositoryRoot, ".git");
  const value = await readFile(dotGit, "utf8").catch(() => undefined);
  if (value === undefined) return dotGit;
  const match = /^gitdir:\s*(.+)\s*$/iu.exec(value);
  if (match?.[1] === undefined) return dotGit;
  return path.resolve(repositoryRoot, match[1]);
}

export async function readRepositoryHead(repositoryRoot: string): Promise<string> {
  const directory = await gitDirectory(repositoryRoot);
  const head = (await readFile(path.join(directory, "HEAD"), "utf8")).trim();
  if (shaPattern.test(head)) return head;
  const reference = /^ref:\s*(refs\/[^\s]+)$/u.exec(head)?.[1];
  if (reference === undefined) throw new Error("Repository HEAD is invalid");
  const commonRelative = (
    await readFile(path.join(directory, "commondir"), "utf8").catch(() => ".")
  ).trim();
  const commonDirectory = path.resolve(directory, commonRelative);
  const resolved = (await readFile(path.join(commonDirectory, reference), "utf8")).trim();
  if (!shaPattern.test(resolved)) throw new Error("Repository HEAD reference is invalid");
  return resolved;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const repositoryRoot = process.cwd();
  const evidencePath = path.join(repositoryRoot, ".generated-tmp/live-demo-readiness.json");
  const evidence = await readFile(evidencePath, "utf8")
    .then((value) => JSON.parse(value) as unknown)
    .catch(() => undefined);
  const result = await verifyLiveDemoReadiness({
    repositoryRoot,
    evidence,
    repositoryHead: await readRepositoryHead(repositoryRoot),
    now: new Date(),
    currentNodeVersion: process.version.replace(/^v/u, ""),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.replayReady) process.exitCode = 1;
}

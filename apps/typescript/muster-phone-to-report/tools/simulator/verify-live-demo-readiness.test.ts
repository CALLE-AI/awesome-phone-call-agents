import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAndInspectProductionArtifacts,
  inspectProductionApplicationGraphs,
  inspectProductionProviderExclusion,
} from "../architecture/simulator-production-boundary.js";

import {
  LIVE_DEMO_READINESS_CHECK_IDS,
  computeLiveDemoWorktreeDigest,
  verifyLiveDemoReadiness,
} from "./verify-live-demo-readiness.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function expectProviderFreeReadinessContract(
  result: Awaited<ReturnType<typeof verifyLiveDemoReadiness>>,
  replayReady: boolean,
): void {
  expect(result).toMatchObject({
    evidenceClass: "LOCAL_PROVIDER_FREE",
    replayReady,
    ready: replayReady,
    liveReadiness: "NOT_ASSESSED",
    authorizesCall: false,
    callAuthorization: "NONE",
    runGate: "CLOSED",
    prohibitedCapabilities: [],
  });
  expect(result.ready).toBe(result.replayReady);
}

async function passingEvidence() {
  const worktreeDigest = await computeLiveDemoWorktreeDigest(repositoryRoot);
  return Object.freeze({
    schemaVersion: "live-demo-readiness.v1" as const,
    repositoryHead: "0123456789abcdef0123456789abcdef01234567",
    worktreeDigest,
    nodeVersion: "24.18.0",
    pnpmVersion: "11.20.0",
    generatedAt: "2026-08-12T03:10:00.000Z",
    checks: LIVE_DEMO_READINESS_CHECK_IDS.map((id) =>
      Object.freeze({ id, status: "passed" as const, testName: `machine proof: ${id}` }),
    ),
  });
}

describe("non-calling live demo readiness verifier", () => {
  it("keeps the recorder's deterministic-replay check aligned with the handoff assertion", async () => {
    const [recorder, handoff] = await Promise.all([
      readFile(path.join(repositoryRoot, "tools/simulator/record-live-demo-readiness.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "tools/simulator/live-demo-handoff.test.ts"), "utf8"),
    ]);
    const mappedTitle = /"deterministic-replay-fallback":\s*\n\s*"([^"]+)"/u.exec(recorder)?.[1];

    expect(mappedTitle).toBeDefined();
    expect(handoff).toContain(`it("${mappedTitle}"`);
  });

  it("AC-ENTRY-2 AC-ERROR-6 requires the exact toolchain and fresh live-capability-free production graphs and artifacts", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { readonly engines?: Readonly<Record<string, string>> };
    expect(manifest.engines).toEqual({ node: "24.18.0", pnpm: "11.20.0" });

    const [graphs, providerBoundary, artifacts] = await Promise.all([
      inspectProductionApplicationGraphs({ repositoryRoot }),
      inspectProductionProviderExclusion({ repositoryRoot }),
      buildAndInspectProductionArtifacts(repositoryRoot),
    ]);
    expect(graphs.violations).toEqual([]);
    expect(providerBoundary.violations).toEqual([]);
    expect(artifacts.forbiddenMarkers).toEqual([]);
    expect(artifacts.applications["web"]?.files).toContain("index.html");
    expect(artifacts.applications["web"]?.files).not.toContain("simulator.html");
    expect(artifacts.applications["web"]?.files.some((file) => /simulator/iu.test(file))).toBe(
      false,
    );
  });

  it("accepts only current machine evidence bound to HEAD, worktree content, and the exact toolchain", async () => {
    const evidence = await passingEvidence();
    const result = await verifyLiveDemoReadiness({
      repositoryRoot,
      evidence,
      repositoryHead: evidence.repositoryHead,
      now: new Date("2026-08-12T03:15:00.000Z"),
      currentNodeVersion: "24.18.0",
    });

    expectProviderFreeReadinessContract(result, true);
    expect(result.checks.map(({ id }) => id)).toEqual(LIVE_DEMO_READINESS_CHECK_IDS);
    expect(result.checks.every(({ ready }) => ready)).toBe(true);
    expect(result.checks.every(({ evidence }) => evidence.startsWith("machine proof:"))).toBe(true);
  });

  it("fails closed when machine evidence is missing or malformed", async () => {
    const result = await verifyLiveDemoReadiness({
      repositoryRoot,
      evidence: undefined,
      repositoryHead: "0123456789abcdef0123456789abcdef01234567",
      now: new Date("2026-08-12T03:15:00.000Z"),
      currentNodeVersion: "24.18.0",
    });

    expectProviderFreeReadinessContract(result, false);
    expect(result.reason).toBe("evidence_missing_or_invalid");
  });

  it.each([
    ["wrong HEAD", { repositoryHead: "fedcba9876543210fedcba9876543210fedcba98" }],
    ["stale worktree", { worktreeDigest: "0".repeat(64) }],
    ["wrong Node", { nodeVersion: "24.14.0" }],
    ["wrong pnpm", { pnpmVersion: "11.19.0" }],
    ["stale timestamp", { generatedAt: "2026-08-11T00:00:00.000Z" }],
  ])("rejects %s evidence", async (_label, mutation) => {
    const evidence = { ...(await passingEvidence()), ...mutation };
    const result = await verifyLiveDemoReadiness({
      repositoryRoot,
      evidence,
      repositoryHead: "0123456789abcdef0123456789abcdef01234567",
      now: new Date("2026-08-12T03:15:00.000Z"),
      currentNodeVersion: "24.18.0",
    });
    expectProviderFreeReadinessContract(result, false);
  });

  it.each(["failed", "skipped", "missing"] as const)(
    "rejects a %s required check",
    async (status) => {
      const evidence = await passingEvidence();
      const result = await verifyLiveDemoReadiness({
        repositoryRoot,
        evidence: {
          ...evidence,
          checks: evidence.checks.map((check, index) =>
            index === 0 ? { ...check, status } : check,
          ),
        },
        repositoryHead: evidence.repositoryHead,
        now: new Date("2026-08-12T03:15:00.000Z"),
        currentNodeVersion: "24.18.0",
      });
      expectProviderFreeReadinessContract(result, false);
    },
  );

  it("owns no provider, credential, environment-file, external-network, tunnel, deploy, publish, or submit capability", async () => {
    const evidence = await passingEvidence();
    const result = await verifyLiveDemoReadiness({
      repositoryRoot,
      evidence,
      repositoryHead: evidence.repositoryHead,
      now: new Date("2026-08-12T03:15:00.000Z"),
      currentNodeVersion: "24.18.0",
    });
    expectProviderFreeReadinessContract(result, true);

    const verifierSource = await readFile(
      path.join(repositoryRoot, "tools/simulator/verify-live-demo-readiness.ts"),
      "utf8",
    );
    expect(verifierSource).toContain('schemaVersion: "live-demo-readiness.v1"');
    expect(verifierSource).toContain("if (!result.replayReady) process.exitCode = 1;");
  });

  it.each([
    ["network preload", "tools/simulator/loopback-only-network-preload.mjs"],
    ["transitive production source", "packages/domain/src/transitive-reading.ts"],
  ])("invalidates evidence after a %s mutation", async (_label, relativePath) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "muster-readiness-digest-"));
    try {
      await mkdir(path.join(temporaryRoot, path.dirname(relativePath)), { recursive: true });
      await writeFile(path.join(temporaryRoot, relativePath), "export const value = 1;\n", "utf8");
      await mkdir(path.join(temporaryRoot, ".generated-tmp"), { recursive: true });
      await writeFile(
        path.join(temporaryRoot, ".generated-tmp/live-demo-readiness.json"),
        "generated evidence must not self-invalidate\n",
        "utf8",
      );
      const digest = await computeLiveDemoWorktreeDigest(temporaryRoot);
      const evidence = { ...(await passingEvidence()), worktreeDigest: digest };

      const readyResult = await verifyLiveDemoReadiness({
        repositoryRoot: temporaryRoot,
        evidence,
        repositoryHead: evidence.repositoryHead,
        now: new Date("2026-08-12T03:15:00.000Z"),
        currentNodeVersion: "24.18.0",
      });
      expectProviderFreeReadinessContract(readyResult, true);

      await writeFile(path.join(temporaryRoot, relativePath), "export const value = 2;\n", "utf8");
      const staleResult = await verifyLiveDemoReadiness({
        repositoryRoot: temporaryRoot,
        evidence,
        repositoryHead: evidence.repositoryHead,
        now: new Date("2026-08-12T03:15:00.000Z"),
        currentNodeVersion: "24.18.0",
      });
      expectProviderFreeReadinessContract(staleResult, false);
      expect(staleResult.reason).toBe("evidence_stale_or_failed");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

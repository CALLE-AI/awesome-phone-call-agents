import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildAndInspectProductionArtifacts } from "./simulator-production-boundary.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const guardedRuntimeSource =
  "apps/simulator-host/src/composition/guarded-live-smoke-runtime.ts" as const;
const reviewBoundarySource =
  "apps/simulator-host/src/composition/live-demo-review-boundary.ts" as const;
const exactPoisonedBindingCall = `
startBoundLiveDemoReviewRuntime({
  protectedCleanup: Object.freeze({ cleanup: async () => undefined }),
});`;

async function reviewIsolationPolicy() {
  return await import("./live-demo-review-isolation.js");
}

describe("live Demo Review provider and production isolation", () => {
  it("AC-VERIFY-1 permits only the transitive provider-free review graph and exact route surface", async () => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();
    const result = await inspectLiveDemoReviewIsolation({ repositoryRoot });

    expect(result.violations).toEqual([]);
    expect(result.importGraph).toContain(
      "apps/simulator-host/src/composition/live-demo-review-runtime-binding.ts",
    );
    expect(result.importGraph).toContain(
      "apps/simulator-host/src/composition/start-live-demo-review-runtime.ts",
    );
    expect(result.importGraph).toContain(reviewBoundarySource);
    expect(result.importGraph).toContain(
      "apps/simulator-host/src/live-runs/live-demo-review-session.ts",
    );
    expect(result.routes).toEqual([
      "GET /api/v1/live-simulator/operations/{operationId}",
      "DELETE /api/v1/live-demo-review/sessions/{sessionId}",
    ]);
    expect(result.cleanupTriggers).toEqual(["finish", "ttl", "interrupt", "restart"]);
    expect(result.bindingCallsiteVerified).toBe(true);
  });

  it.each([
    [
      "cleanup alias reassignment",
      (source: string) =>
        source.replace(
          "const cleanupOwner = createLiveDemoReviewCleanupOwner(input.cleanupOwner);",
          [
            "let cleanupOwner = createLiveDemoReviewCleanupOwner(input.cleanupOwner);",
            "cleanupOwner = Object.freeze({",
            "  cleanup: async (trigger: LiveDemoReviewCleanupTrigger) => {",
            "    await ensureControl().restore();",
            "    return await createLiveDemoReviewCleanupOwner(input.cleanupOwner).cleanup(trigger);",
            "  },",
            "});",
          ].join("\n"),
        ),
    ],
    [
      "hidden path alias",
      (source: string) =>
        source.replace(
          "const selected =",
          [
            'const hiddenPath = "/api/v1/live-demo-review/hidden";',
            "const selected = input.path === hiddenPath ? operation :",
          ].join("\n"),
        ),
    ],
    ["broadened methods", (source: string) => source.replace('method: "GET"', 'method: "POST"')],
    [
      "broadened cleanup method",
      (source: string) => source.replace('method: "DELETE"', 'method: "PATCH"'),
    ],
    [
      "altered route table",
      (source: string) =>
        source.replace(
          'route: "GET /api/v1/live-simulator/operations/{operationId}"',
          'route: "GET /api/v1/live-simulator/operations/{operationId}/all"',
        ),
    ],
    [
      "forbidden transitive acquisition",
      (source: string) => `${source}\nvoid import("@muster/infrastructure-twilio-simulator");`,
    ],
  ])("rejects the provider-free boundary %s mutation", async (_label, mutate) => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();
    const source = await readFile(path.join(repositoryRoot, reviewBoundarySource), "utf8");
    const mutated = mutate(source);
    expect(mutated).not.toBe(source);
    const result = await inspectLiveDemoReviewIsolation({
      repositoryRoot,
      sourceOverrides: { [reviewBoundarySource]: mutated },
    });
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("AC-VERIFY-1 independently rejects direct, transitive, and reflective capability mutations", async () => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();

    const result = await inspectLiveDemoReviewIsolation({
      repositoryRoot,
      sourceMutations: {
        "apps/simulator-host/src/composition/start-live-demo-review-runtime.ts": [
          'import "@muster/infrastructure-twilio-simulator";',
          'const acquire = globalThis["Function"]("return process.env")();',
        ].join("\n"),
        "apps/simulator-host/src/live-runs/live-demo-review-session.ts":
          'import "../cli/guarded-live-smoke-main.js";',
      },
    });

    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("provider capability import"),
        expect.stringContaining("reflective capability acquisition"),
        expect.stringContaining("dispatch or callback composition import"),
      ]),
    );
  });

  it.each([
    ["CommonJS require", 'const sdk = require("twilio");', "provider capability import"],
    ["direct eval", 'eval("process.env")', "reflective capability acquisition"],
    ["direct Function", 'Function("return process.env")()', "reflective capability acquisition"],
    [
      "obfuscated Function",
      'globalThis["Fun" + "ction"]("return process.env")()',
      "reflective capability acquisition",
    ],
    ["reflected environment", 'Reflect.get(process, "env")', "reflective capability acquisition"],
    [
      "computed global environment",
      'globalThis["pro" + "cess"]["e" + "nv"]',
      "reflective capability acquisition",
    ],
    ["dynamic module", "import(providerModule)", "reflective capability acquisition"],
    [
      "inline GET handler",
      'router.get("/api/v1/live-demo-review/extra", handler)',
      "review runtime route surface",
    ],
    [
      "differently named DELETE handler",
      'cleanupRouter.delete("/api/v1/live-demo-review/other", handler)',
      "review runtime route surface",
    ],
    [
      "added POST handler",
      'router.post("/api/v1/live-demo-review/extra", handler)',
      "review runtime route surface",
    ],
  ])("rejects the %s mutation through AST inspection", async (_label, mutation, violation) => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();
    const result = await inspectLiveDemoReviewIsolation({
      repositoryRoot,
      sourceMutations: {
        "apps/simulator-host/src/composition/live-demo-review-runtime-binding.ts": mutation,
      },
    });
    expect(result.violations.some((message) => message.includes(violation))).toBe(true);
  });

  it("rejects bypassing the closed binding at the actual guarded composition callsite", async () => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();
    const result = await inspectLiveDemoReviewIsolation({
      repositoryRoot,
      sourceMutations: {
        "apps/simulator-host/src/composition/guarded-live-smoke-runtime.ts":
          "startLiveDemoReviewRuntime({});",
      },
    });
    expect(result.bindingCallsiteVerified).toBe(false);
    expect(result.violations).toContain(
      "guarded runtime does not use the closed Demo Review binding callsite",
    );
  });

  it("rejects a second exact-key binding callsite even when the first remains valid", async () => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();
    const result = await inspectLiveDemoReviewIsolation({
      repositoryRoot,
      sourceMutations: { [guardedRuntimeSource]: exactPoisonedBindingCall },
    });

    expect(result.bindingCallsiteVerified).toBe(false);
    expect(result.violations).toContain(
      "guarded runtime does not use the closed Demo Review binding callsite",
    );
  });

  it.each([
    ["second native server", "createServer((_request, _response) => undefined);"],
    ["hidden request listener", 'server.on("request", (_request, _response) => undefined);'],
    [
      "hidden native route branch",
      'if (request.url === "/api/v1/live-demo-review/hidden") response.end();',
    ],
  ])("rejects a %s outside the closed native dispatcher", async (_label, mutation) => {
    const { inspectLiveDemoReviewIsolation } = await reviewIsolationPolicy();
    const result = await inspectLiveDemoReviewIsolation({
      repositoryRoot,
      sourceMutations: {
        "apps/simulator-host/src/composition/start-live-demo-review-runtime.ts": mutation,
      },
    });

    expect(result.violations.some((message) => message.includes("native request routing"))).toBe(
      true,
    );
  });

  it("AC-VERIFY-1 supplies independent poison traps for every forbidden runtime acquisition", async () => {
    const { createLiveDemoReviewRuntimeAcquisitionTrap } = await reviewIsolationPolicy();
    const trap = createLiveDemoReviewRuntimeAcquisitionTrap({ safe: "review-only" });
    expect(trap.input.safe).toBe("review-only");
    expect(trap.acquisitions).toEqual([]);

    for (const capability of [
      "createCalleClient",
      "createTwilioClient",
      "loadProviderCredentials",
      "openTunnel",
      "acceptProviderCallback",
      "dispatchCall",
      "mintAuthorization",
    ]) {
      expect(() => Reflect.get(trap.input, capability)).toThrow(
        `Demo Review attempted forbidden capability acquisition: ${capability}`,
      );
    }
    expect(trap.acquisitions).toEqual([
      "createCalleClient",
      "createTwilioClient",
      "loadProviderCredentials",
      "openTunnel",
      "acceptProviderCallback",
      "dispatchCall",
      "mintAuthorization",
    ]);
  });

  it("AC-VERIFY-2 accepts allowlisted lifecycle logs and rejects protected captured or tracked artifacts", async () => {
    const { inspectLiveDemoReviewPrivacy } = await reviewIsolationPolicy();
    const safe = await inspectLiveDemoReviewPrivacy({
      repositoryRoot,
      capturedLifecycleFacts: [
        {
          lifecycleState: "review_ready",
          cleanupOutcome: "pending",
          operationId: "operation-review-isolation",
          scenarioId: "synthetic-normal",
          scenarioRevision: 1,
          reviewReadyAt: "2026-09-02T12:00:00.000Z",
          reviewExpiresAt: "2026-09-02T12:30:00.000Z",
          opaqueRecoveryId: "recovery-review-isolation",
          resourceVersion: 7,
        },
      ],
    });
    expect(safe.violations).toEqual([]);
    expect(safe.inspectedFiles).toEqual(
      expect.arrayContaining([
        "packages/testing/src/fixtures/observation-source-fixtures.ts",
        "tests/fixtures/providers/calle/grounded-reading/simulated-edge-cases.json",
      ]),
    );

    const forbiddenKey = ["provider", "Payload"].join("");
    const protectedValue = ["+1", "202", "555", "0187"].join("");
    const leaked = await inspectLiveDemoReviewPrivacy({
      repositoryRoot,
      capturedLifecycleFacts: [{ [forbiddenKey]: protectedValue }],
      trackedArtifactMutations: {
        "docs/demo/forbidden-review-capture.md": ["SK", "a".repeat(32)].join(""),
      },
    });
    expect(leaked.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("non-allowlisted lifecycle fact providerPayload"),
        expect.stringContaining("phone value"),
        expect.stringContaining("credential-shaped value"),
      ]),
    );
  });

  it("AC-VERIFY-2 rejects every protected class across browser, output, telemetry, snapshot, and package fixture surfaces", async () => {
    const { inspectLiveDemoReviewPrivacy } = await reviewIsolationPolicy();
    const result = await inspectLiveDemoReviewPrivacy({
      repositoryRoot,
      capturedSurfaces: {
        url: "http://127.0.0.1/review?permit=one-use-value",
        storage: { transcriptBody: "synthetic protected sentence", theme: "dark" },
        stdout: "contact +44 20 7946 0958",
        stderr: {
          targetAddress: "private-target.example",
          targetPayload: "synthetic target payload",
        },
        logs: {
          providerIdentity: ["CA", "b".repeat(32)].join(""),
          callbackPayload: "synthetic callback payload",
          permit: "one-use-value-outside-a-url",
        },
        spans: { rawCustodyPath: "C:\\protected\\review\\capture.txt" },
        metrics: {
          credential: ["SK", "c".repeat(32)].join(""),
          authorizationHeader: "Bearer synthetic-private-value",
        },
      },
      trackedArtifactMutations: {
        "packages/example/src/__snapshots__/review.snap": '{"providerPayload":{"private":"value"}}',
        "packages/example/src/fixtures/review.fixture.json":
          '{"targetAddress":"private-target.example"}',
      },
    });

    for (const surface of [
      "url",
      "storage",
      "stdout",
      "stderr",
      "logs",
      "spans",
      "metrics",
      "packages/example/src/__snapshots__/review.snap",
      "packages/example/src/fixtures/review.fixture.json",
    ]) {
      expect(
        result.violations.some((message) => message.includes(surface)),
        surface,
      ).toBe(true);
    }
    for (const protectedClass of [
      "transcriptBody",
      "targetAddress",
      "targetPayload",
      "providerIdentity",
      "callbackPayload",
      "permit",
      "rawCustodyPath",
      "credential",
      "authorizationHeader",
    ]) {
      expect(
        result.violations.some((message) => message.includes(protectedClass)),
        protectedClass,
      ).toBe(true);
    }
    expect(result.violations).toContain("storage: non-allowlisted browser storage field theme");
  });

  it("scans safe untracked artifact candidates without reading ignored evidence", async () => {
    const { inspectLiveDemoReviewPrivacy } = await reviewIsolationPolicy();
    const untracked = "packages/testing/src/fixtures/untracked-review-privacy.fixture.json";
    const ignored = "test-results/ignored-review-privacy.fixture.json";
    await mkdir(path.dirname(path.join(repositoryRoot, untracked)), { recursive: true });
    await mkdir(path.dirname(path.join(repositoryRoot, ignored)), { recursive: true });
    try {
      await writeFile(
        path.join(repositoryRoot, untracked),
        '{"transcriptBody":"synthetic untracked protected sentence"}',
        "utf8",
      );
      await writeFile(
        path.join(repositoryRoot, ignored),
        '{"credential":"synthetic ignored sentinel that must not be read"}',
        "utf8",
      );

      const result = await inspectLiveDemoReviewPrivacy({ repositoryRoot });

      expect(result.inspectedFiles).toContain(untracked);
      expect(result.inspectedFiles).not.toContain(ignored);
      expect(result.violations).toContain(`${untracked}: protected field value`);
      expect(result.violations.some((message) => message.includes(ignored))).toBe(false);
    } finally {
      await rm(path.join(repositoryRoot, untracked), { force: true });
      await rm(path.join(repositoryRoot, ignored), { force: true });
    }
  });

  it("AC-INTEGRATION-2 preserves generated production exclusion for every Demo Review marker", async () => {
    const { inspectLiveDemoReviewArtifactContents } = await reviewIsolationPolicy();
    const artifacts = await buildAndInspectProductionArtifacts(repositoryRoot);
    expect(artifacts.forbiddenMarkers).toEqual([]);
    expect(artifacts.applications["web"]?.files).not.toContain("simulator.html");

    expect(
      inspectLiveDemoReviewArtifactContents({
        "assets/main.js": "start-live-demo-review-runtime /api/v1/live-demo-review/",
      }).violations,
    ).toEqual([
      "assets/main.js: start-live-demo-review-runtime",
      "assets/main.js: /api/v1/live-demo-review/",
    ]);
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LIVE_DEMO_BROWSER_STORAGE_ALLOWLIST,
  LIVE_DEMO_COPY,
  LIVE_DEMO_LOG_FACT_ALLOWLIST,
  LIVE_DEMO_MUST_ACCEPTANCE_CONTRACTS,
  LIVE_DEMO_PRIVACY_DENYLIST,
  LIVE_DEMO_RUBRIC,
  REQUIRED_LIVE_SUCCESS_FACTS,
  SYNTHETIC_RESULT_FREE_FAILURE_FACTS,
} from "./live-demo-review-contract.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const mustAcceptanceIds = Object.freeze([
  "AC-ENTRY-1",
  "AC-ENTRY-2",
  "AC-HAPPY-1",
  "AC-HAPPY-2",
  "AC-ERROR-1",
  "AC-ERROR-2",
  "AC-ERROR-3",
  "AC-ASYNC-1",
  "AC-ASYNC-2",
  "AC-ASYNC-3",
  "AC-VERIFY-1",
  "AC-VERIFY-2",
  "AC-VERIFY-3",
  "AC-VERIFY-4",
  "AC-INTEGRATION-1",
  "AC-INTEGRATION-2",
  "AC-INTEGRATION-3",
] as const);

describe("recording-safe live demo review contract", () => {
  it("publishes the approved invocation, success, review, action, and cleanup wording exactly", () => {
    expect(LIVE_DEMO_COPY).toEqual({
      invocation: "corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal",
      success: "Live simulated observation complete",
      evidenceRail:
        "CALL-E dispatched -> Twilio synthetic device answered -> transcript admitted -> four readings grounded -> routing safely restored",
      reviewReady: "External call capability closed—review available for 30 minutes",
      finishAction: "Finish demo and delete result",
      deleted: "Protected demo result deleted",
      cleanupAttention: "Cleanup requires attention",
    });
    expect(LIVE_DEMO_COPY.reviewReady).not.toContain("â");
    expect(
      [...LIVE_DEMO_COPY.reviewReady].find((character) => character === "—")?.codePointAt(0),
    ).toBe(0x2014);
  });

  it("keeps the root command guarded and documents automatic exact attachment and fixed cleanup", async () => {
    const [manifestText, contract] = await Promise.all([
      readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      readFile(path.join(repositoryRoot, "docs/api/simulator-host-live-runs.md"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as { readonly scripts: Record<string, string> };

    expect(manifest.scripts["simulator:live-smoke:run"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:run",
    );
    expect(Object.keys(manifest.scripts).filter((name) => /permit|dispatch/iu.test(name))).toEqual(
      [],
    );
    expect(contract).toContain(LIVE_DEMO_COPY.invocation);
    expect(contract).toContain("opens Simulator Lab automatically");
    expect(contract).toContain("server observes its first successful exact-operation GET");
    expect(contract).toContain("fixed 30-minute review ceiling");
    expect(contract).toContain(`**${LIVE_DEMO_COPY.reviewReady}**`);
    expect(contract).toContain(`**${LIVE_DEMO_COPY.finishAction}**`);
  });

  it("defines only the exact browser tuple and bounded lifecycle facts as allowlisted state", () => {
    expect(LIVE_DEMO_BROWSER_STORAGE_ALLOWLIST).toEqual([
      "operationId",
      "scenarioId",
      "scenarioRevision",
    ]);
    expect(LIVE_DEMO_LOG_FACT_ALLOWLIST).toEqual([
      "lifecycleState",
      "cleanupOutcome",
      "operationId",
      "scenarioId",
      "scenarioRevision",
      "reviewReadyAt",
      "reviewExpiresAt",
      "opaqueRecoveryId",
      "resourceVersion",
    ]);
  });

  it("deny-lists every protected/provider field class from browser, output, telemetry, and Git", () => {
    expect(LIVE_DEMO_PRIVACY_DENYLIST).toEqual([
      "permit",
      "transcriptBody",
      "phoneNumber",
      "targetAddress",
      "providerIdentity",
      "providerPayload",
      "callbackPayload",
      "credential",
      "authorizationHeader",
      "rawCustodyPath",
    ]);
  });

  it("defines success requirements without embedding observed provider facts", () => {
    expect(REQUIRED_LIVE_SUCCESS_FACTS).toEqual({
      evidenceClass: "required_live_success_contract",
      isObservedEvidence: false,
      providerDispatchCount: 1,
      signedCallbacks: ["voice", "canary", "status"],
      dtmfCount: 0,
      evidenceRecordCount: 1,
      observationCount: 1,
      groundedReadingCount: 4,
      reconciliationOutcome: "one_matching_completed_call",
      hostedRejectRestored: true,
      ownedCleanupCompleted: true,
    });
  });

  it("keeps the later failure synthetic, result-free, nonretrying, and ineligible for success", () => {
    expect(SYNTHETIC_RESULT_FREE_FAILURE_FACTS).toEqual({
      evidenceClass: "synthetic_result_free_regression",
      fixtureSource: "privacy_safe_synthetic_fixture",
      safeFailureCode: "provider_evidence_invalid_auxiliary_status",
      evidenceRecordCount: 0,
      observationCount: 0,
      readingCount: 0,
      retryable: false,
      eligibleForLiveSuccess: false,
      readsProtectedLocalEvidence: false,
    });
    expect(SYNTHETIC_RESULT_FREE_FAILURE_FACTS.evidenceClass).not.toBe(
      REQUIRED_LIVE_SUCCESS_FACTS.evidenceClass,
    );
  });

  it("maps the four hackathon categories to a genuine under-three-minute proof", () => {
    expect(LIVE_DEMO_RUBRIC.recordingCeilingSeconds).toBe(180);
    expect(LIVE_DEMO_RUBRIC.categories.map(({ id }) => id)).toEqual([
      "real_world_impact",
      "quality_of_idea",
      "technical_implementation",
      "product_experience_and_demo",
    ]);
    expect(LIVE_DEMO_RUBRIC.claimCeilings).toEqual([
      "SIMULATED",
      "non-production",
      "physical hardware unproven",
    ]);
  });

  it("names one explicit executable contract row for every MUST acceptance category", () => {
    expect(LIVE_DEMO_MUST_ACCEPTANCE_CONTRACTS.map(({ acceptanceId }) => acceptanceId)).toEqual(
      mustAcceptanceIds,
    );
    expect(
      LIVE_DEMO_MUST_ACCEPTANCE_CONTRACTS.every(
        ({ contractName, initialRedContract }) =>
          contractName.trim().length > 0 && initialRedContract === true,
      ),
    ).toBe(true);
    expect(
      new Set(LIVE_DEMO_MUST_ACCEPTANCE_CONTRACTS.map(({ contractName }) => contractName)).size,
    ).toBe(mustAcceptanceIds.length);
  });
});

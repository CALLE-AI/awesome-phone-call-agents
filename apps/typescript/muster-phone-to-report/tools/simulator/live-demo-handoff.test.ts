import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LIVE_DEMO_RUBRIC,
  REQUIRED_LIVE_SUCCESS_FACTS,
  SYNTHETIC_RESULT_FREE_FAILURE_FACTS,
} from "./live-demo-review-contract.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function document(fileName: string): Promise<string> {
  return await readFile(path.join(repositoryRoot, "docs/demo", fileName), "utf8");
}

describe("live demo handoff artifacts", () => {
  it("keeps replay dependable and scopes the successful CALL-E-to-Twilio synthetic evidence", async () => {
    const demo = await document("hackathon-live-calle-observation.md");
    const prose = demo.replace(/\s+/gu, " ");
    expect(demo).toContain("corepack pnpm generate:simulator-demo");
    expect(demo).toContain("successful non-production synthetic observation");
    expect(demo).toContain("No observed provider-call records are bundled.");
    expect(prose).toContain(
      "Historical success or failure never establishes present live-recording readiness.",
    );
    expect(prose).toContain(
      "`replayReady` reports whether current checkout-bound deterministic replay evidence passes.",
    );
    expect(prose).toContain("`ready` is an exact compatibility alias of `replayReady`.");
    expect(prose).toContain('`liveReadiness: "NOT_ASSESSED"`');
    expect(demo).toMatch(/one matching completed\s+Twilio call/);
    expect(demo).toContain("zero DTMF");
    expect(prose).toContain("does not establish Sensaphone hardware behavior");
    expect(demo).toContain("exact predecessor operation ID");
    expect(demo).toContain("Under-three-minute rubric-mapped recording script");
  });

  it("keeps submission drafts local and traces the current official requirements", async () => {
    const [awesome, devpost] = await Promise.all([
      document("awesome-phone-call-agents-submission.md"),
      document("devpost-requirement-traceability.md"),
    ]);
    expect(awesome).toContain("pull-request-ready repository-local draft only");
    expect(awesome).toContain("Independent anti-stub proof");
    expect(awesome).toContain("one matching completed call");
    expect(awesome).toContain("python3 scripts/validate_repository.py");
    expect(devpost).toContain("Refreshed from official sources: 2026-09-10");
    expect(devpost).toContain("September 14, 2026 at 11:45 PM SGT");
    expect(devpost).toContain("under three minutes");
    expect(devpost).toContain("CALL-E account email");
    expect(devpost).toContain(
      "CALL-E-to-Twilio live success is not established by bundled fixtures",
    );
    expect(devpost).toContain("Four equally weighted judging criteria");
  });

  it("AC-VERIFY-4 AC-INTEGRATION-2 keeps success requirements, synthetic failure, rubric, and timed recording handoff distinct", async () => {
    const demo = await document("hackathon-live-calle-observation.md");
    expect(REQUIRED_LIVE_SUCCESS_FACTS).toMatchObject({
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
    expect(SYNTHETIC_RESULT_FREE_FAILURE_FACTS).toMatchObject({
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
    expect(LIVE_DEMO_RUBRIC.recordingCeilingSeconds).toBe(180);
    expect(LIVE_DEMO_RUBRIC.categories).toHaveLength(4);
    expect(LIVE_DEMO_RUBRIC.claimCeilings).toEqual([
      "SIMULATED",
      "non-production",
      "physical hardware unproven",
    ]);

    const recordingStart = demo.indexOf("## Recording-safe Demo Review timed handoff");
    const recordingEnd = demo.indexOf("## Deferred live-validation matrix");
    expect(recordingStart).toBeGreaterThanOrEqual(0);
    expect(recordingEnd).toBeGreaterThan(recordingStart);
    const handoff = demo.slice(recordingStart, recordingEnd);
    expect(demo).not.toMatch(/leave live mode uninvoked[^.]*during[^.]*recording/iu);
    expect(demo).not.toContain("during rehearsal and recording");
    expect(demo).toContain("Provider-free deterministic rehearsal and recording");
    expect(demo).toContain("Separately authorized live recording");
    expect(handoff.replace(/\s+/gu, " ")).toContain(
      "Provider-free applies to rehearsal and automated verification; it does not describe the separately and freshly authorized live-recording path.",
    );
    expect(handoff).toContain("**1:25-2:20 — Demo Review and Finish.**");
    expect(handoff).not.toContain("Provider-safe review");
    for (const requiredText of [
      "Target runtime: `2:45-2:55`",
      "corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal",
      "opens Simulator Lab automatically",
      "server-observed exact GET",
      "viewer readiness",
      "External call capability closed—review available for 30 minutes",
      "fixed 30-minute review window",
      "Finish demo and delete result",
      "Protected demo result deleted",
      "Cleanup requires attention",
      "Deterministic replay (not the live result)",
      "SIMULATED",
      "non-production",
      "physical hardware",
    ]) {
      expect(handoff, requiredText).toContain(requiredText);
    }
    const timedSteps = ["0:00-0:20", "0:20-0:40", "0:40-1:25", "1:25-2:20", "2:20-2:50"];
    let priorIndex = -1;
    for (const step of timedSteps) {
      const currentIndex = handoff.indexOf(step);
      expect(currentIndex, step).toBeGreaterThan(priorIndex);
      priorIndex = currentIndex;
    }
  });
});

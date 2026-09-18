import { describe, expect, it } from "vitest";

import {
  assertReplayInvariants,
  END_TO_END_REPLAY_FIXTURES,
  getReplayFixture,
  replayEndToEnd,
  replaySnapshots,
} from "../lib/mock-calls";
import {
  operatorCallFromReplay,
  operatorIncidentFromReplay,
  summarizeOperatorCalls,
} from "../lib/operator-dashboard";

describe("Call-E end-to-end replay", () => {
  it("holds invariants on every fixture, including failover", () => {
    expect(END_TO_END_REPLAY_FIXTURES.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "replay-e2e-complete",
        "replay-e2e-provider-failover",
        "replay-e2e-failover-exhausted",
      ]),
    );
    for (const fixture of END_TO_END_REPLAY_FIXTURES) {
      const state = replayEndToEnd(fixture);
      expect(assertReplayInvariants(fixture, state), fixture.id).toEqual([]);
      expect(state.events.join("\n")).not.toMatch(/Bearer\s+(?!<REDACTED>)\S+/i);
    }
  });

  it("replays step snapshots without drifting the seed run_id", () => {
    const fixture = getReplayFixture("replay-e2e-provider-failover");
    const snapshots = replaySnapshots(fixture);
    expect(snapshots).toHaveLength(fixture.steps.length);
    const minted = snapshots[snapshots.length - 1]?.mintedRunIds ?? [];
    expect(new Set(minted).size).toBe(1);
    expect(minted[0]).toBe(fixture.seedRunId);
  });

  it("fails over from CALL-E to the backup phone API and keeps one run_id", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-provider-failover"));
    expect(state.phoneProviderId).toBe("backup-phone-api");
    expect(state.failoverAttempts).toBe(2);
    expect(state.runId).toBe("backup-phone-api_run_failover");
    expect(state.mintedRunIds).toEqual(["backup-phone-api_run_failover"]);
    expect(state.events.some((event) => event.includes("call-e rejected"))).toBe(true);
    expect(state.events.some((event) => event.includes("backup-phone-api accepted"))).toBe(true);
  });

  it("does not mint a second run when every phone API is down", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-failover-exhausted"));
    expect(state.phoneProviderId).toBeNull();
    expect(state.failoverAttempts).toBe(3);
    expect(state.mintedRunIds).toEqual(["run_mock_outage"]);
    expect(state.status).toBe("queued");
  });

  it("projects replay outcomes onto operator dashboard rows", () => {
    const rows = END_TO_END_REPLAY_FIXTURES.map((fixture) => {
      const state = replayEndToEnd(fixture);
      const call = operatorCallFromReplay(fixture, state);
      const incident = operatorIncidentFromReplay(fixture, state);
      expect(call.replayId).toBe(fixture.id);
      expect(call.dryRun).toBe(true);
      expect(call.womanId.startsWith("demo-")).toBe(true);
      return { call, incident };
    });

    const failover = rows.find((row) => row.call.replayId === "replay-e2e-provider-failover");
    expect(failover?.call.bucket).toBe("completed");
    expect(failover?.call.phoneProviderId).toBe("backup-phone-api");
    expect(failover?.incident?.kind).toBe("failover");

    const refusal = rows.find((row) => row.call.replayId === "replay-e2e-refusal");
    expect(refusal?.call.bucket).toBe("blocked");
    expect(refusal?.incident?.kind).toBe("consent_block");

    const summary = summarizeOperatorCalls(rows.map((row) => row.call));
    expect(summary.blocked).toBeGreaterThan(0);
    expect(summary.completed).toBeGreaterThan(0);
  });
});

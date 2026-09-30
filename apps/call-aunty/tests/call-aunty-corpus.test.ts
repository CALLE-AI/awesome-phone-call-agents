import { describe, expect, it } from "vitest";

import {
  applySensitiveAnswerBranch,
  assertReplayInvariants,
  CALL_AUNTY_CORPUS,
  CALL_AUNTY_CORPUS_BASE,
  corpusReplayIds,
  countByChannel,
  END_TO_END_REPLAY_FIXTURES,
  getCorpusFixture,
  getReplayFixture,
  getSensitiveAnswerBranch,
  replayEndToEnd,
  SENSITIVE_ANSWER_BRANCHES,
} from "../lib/mock-calls";

describe("Call Aunty corpus index", () => {
  it("keeps the original 128-row SMS/API/MCP matrix", () => {
    expect(CALL_AUNTY_CORPUS_BASE).toHaveLength(128);
    expect(getCorpusFixture("corpus-001")).toEqual({
      id: "corpus-001",
      channel: "sms",
      scenario: "refusal",
      synthetic: true,
      branch: "none",
    });
    expect(getCorpusFixture("corpus-004")).toMatchObject({ channel: "sms", scenario: "completed" });
  });

  it("adds replay and sensitive-answer rows without duplicate ids", () => {
    const ids = CALL_AUNTY_CORPUS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CALL_AUNTY_CORPUS.length).toBeGreaterThan(128);
    expect(getCorpusFixture("corpus-133").branch).toBe("distress");
    expect(getCorpusFixture("corpus-134").replayId).toBe("replay-e2e-pii");
    expect(countByChannel("sms")).toBeGreaterThan(countByChannel("mcp"));
  });

  it("points extension rows at real replay fixtures", () => {
    for (const replayId of corpusReplayIds()) {
      expect(() => getReplayFixture(replayId)).not.toThrow();
    }
  });
});

describe("Call Aunty end-to-end replay fixtures", () => {
  it("replays every fixture deterministically", () => {
    for (const fixture of END_TO_END_REPLAY_FIXTURES) {
      const first = replayEndToEnd(fixture);
      const second = replayEndToEnd(fixture);
      expect(assertReplayInvariants(fixture, first)).toEqual([]);
      expect(first).toEqual(second);
      expect(first.events.some((event) => event.includes("Bearer "))).toBe(false);
    }
  });

  it("reuses one run_id across a transient REST timeout", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-transient-retry"));
    expect(state.runId).toBe("run_mock_011");
    expect(state.mintedRunIds).toEqual(["run_mock_011"]);
    expect(state.idempotencyKey).toBe("mock-011");
  });

  it("blocks REST create after consent refusal", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-refusal"));
    expect(state.outreachSuppressed).toBe(true);
    expect(state.answers.consent).toBe(false);
    expect(state.mintedRunIds).toEqual([]);
    expect(state.events.some((event) => event.includes("blocked; consent or DNC"))).toBe(true);
  });

  it("requires MCP plan + confirmation before run_call", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-mcp-confirm"));
    expect(state.confirmationGranted).toBe(true);
    expect(state.planId).toBe("plan_mock_012");
    expect(state.events.filter((event) => event.includes("blocked")).length).toBeGreaterThanOrEqual(2);
  });

  it("persists a safety code instead of the distress narrative", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-distress"));
    expect(state.escalation).toBe("safety_script");
    expect(state.answers.q06).toBe("safety_concern_reported");
    expect(JSON.stringify(state.answers)).not.toContain("chest pain");
  });

  it("redacts PII before the REST/MCP result is treated as durable", () => {
    const state = replayEndToEnd(getReplayFixture("replay-e2e-pii"));
    expect(state.answers.q08).toContain("[redacted-email]");
    expect(JSON.stringify(state.answers)).not.toContain("aunty.pat@example.test");
  });
});

describe("Call Aunty sensitive-answer branches", () => {
  it("matches each fixture's category, escalation, and persist contract", () => {
    for (const fixture of SENSITIVE_ANSWER_BRANCHES) {
      const decision = applySensitiveAnswerBranch(fixture);
      expect(decision.category, fixture.id).toBe(fixture.expected.category);
      expect(decision.escalation, fixture.id).toBe(fixture.expected.escalation);
      expect(decision.persistAnswer, fixture.id).toEqual(fixture.expected.persistAnswer);
      expect(decision.nextQuestionId, fixture.id).toBe(fixture.expected.nextQuestionId);
      for (const [flag, value] of Object.entries(fixture.expected.flags)) {
        expect(decision.flags[flag as keyof typeof decision.flags], `${fixture.id}:${flag}`).toBe(value);
      }
      for (const skipped of fixture.expected.skippedContains) {
        expect(decision.skippedQuestionIds, fixture.id).toContain(skipped);
      }
      for (const stillAskable of fixture.expected.skippedExcludes ?? []) {
        expect(decision.skippedQuestionIds, fixture.id).not.toContain(stillAskable);
      }
      for (const script of fixture.expected.agentScriptKeys) {
        expect(decision.agentScriptKeys, fixture.id).toContain(script);
      }
      const persisted = String(decision.persistAnswer ?? "");
      for (const needle of fixture.expected.persistMustNotContain ?? []) {
        expect(persisted.toLowerCase()).not.toContain(needle.toLowerCase());
      }
    }
  });

  it("looks up branches by id", () => {
    expect(getSensitiveAnswerBranch("branch-distress-en").expected.escalation).toBe("safety_script");
    expect(() => getSensitiveAnswerBranch("branch-missing")).toThrow(/Unknown sensitive-answer branch/);
  });
});

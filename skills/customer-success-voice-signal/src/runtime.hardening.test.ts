import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSignal } from "./runSignal.js";
import type { SkillEnv } from "./config/env.js";
import { reserveCue } from "./policy/cueLock.js";
import { normalizeEvent } from "./ingest/normalize.js";
import { categorizeCalleError, scrubErrorText } from "./calle/errors.js";
import { parseStructuredOption, toDecision } from "./map/toDecision.js";
import { pickOptions } from "./policy/options.js";
import { buildCallIntent } from "./calle/intent.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(path.join(root, "fixtures/stuck_support_acme.json"), "utf8"),
);

function baseEnv(dataDir: string, overrides: Partial<SkillEnv> = {}): SkillEnv {
  return {
    calleApiKey: "test_key",
    calleBaseUrl: "https://api.heycall-e.com",
    calleRegion: "US",
    calleLocale: "en-US",
    calleWebhookUrl: "",
    calleWait: true,
    csOwnerE164: "+14155552671",
    csOwnerName: "Maya",
    csOwnerId: "cs_maya",
    signalConfirm: "PLACES",
    houseDarkStart: "00:00",
    houseDarkEnd: "00:00",
    houseDarkTimezone: "UTC",
    dedupeMinutes: 120,
    ownerMaxRings: 2,
    dataDir,
    slackWebhookUrl: "",
    githubToken: "",
    githubRepo: "",
    githubIssue: "",
    ...overrides,
  };
}

describe("failure audit + scrub", () => {
  let tmp: string;
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("scrubs secrets and phones from error text", () => {
    expect(scrubErrorText("Bearer sk-abc123 failed for +14155552671")).toMatch(
      /\[redacted\]/,
    );
    expect(scrubErrorText("Bearer sk-abc123 failed for +14155552671")).toMatch(
      /\[phone\]/,
    );
    expect(categorizeCalleError(new Error("401 unauthorized"))).toMatchObject({
      category: "authentication",
    });
    expect(categorizeCalleError(new Error("socket hang up"))).toMatchObject({
      category: "network",
    });
    expect(categorizeCalleError(new Error("wait timeout"))).toMatchObject({
      category: "timeout",
    });
  });

  it("writes failure audit without cue-history", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-fail-"));
    const dial = vi.fn().mockRejectedValue(new Error("CALL-E 401 unauthorized api_key=SECRET123"));
    const outcome = await runSignal({
      raw: fixture,
      env: baseEnv(tmp),
      liveFlag: true,
      placesTyped: true,
      dryRunFlag: false,
      dial,
    });
    expect(outcome.exit).toBe("failure");
    expect(outcome.result?.decision).toBe("failure");
    expect(outcome.result?.notes_short).not.toMatch(/SECRET123/i);
    const book = await readFile(path.join(tmp, "prompt-book.ndjson"), "utf8");
    expect(book).toMatch(/"decision":"failure"/);
    expect(book).not.toMatch(/SECRET123/);
    const history = await readFile(path.join(tmp, "cue-history.ndjson"), "utf8").catch(
      () => "",
    );
    expect(history).toBe("");
  });
});

describe("concurrent cue reservation", () => {
  let tmp: string;
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("only one of two racing live attempts reaches the dial", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-race-"));
    // Midday UTC so owner LA quiet hours (22–07) are not dark
    const dial = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return {
        call: {
          id: "call_race",
          status: "completed",
          summary: null,
          taskCompleted: true,
          failureCode: null,
          failureMessage: null,
          completionConfidence: { score: 0.9, label: "high" },
          evidence: ["caller confirmed option 1"],
          structuredResult: {
            option_id: "1",
            decision: "take_over_chat",
            decision_label: "Take over in chat now",
            stage_code: "4821",
            identity_confirmed: true,
          },
          recipients: [{ structuredResult: null, summary: null, attempts: [] }],
        },
        structured: {
          option_id: "1",
          decision: "take_over_chat",
          decision_label: "Take over in chat now",
          stage_code: "4821",
          identity_confirmed: true,
        },
        awaited: true,
      };
    });

    const env = baseEnv(tmp);
    const a = runSignal({
      raw: fixture,
      env,
      liveFlag: true,
      placesTyped: true,
      dryRunFlag: false,
      dial,
    });
    const b = runSignal({
      raw: fixture,
      env,
      liveFlag: true,
      placesTyped: true,
      dryRunFlag: false,
      dial,
    });
    const [ra, rb] = await Promise.all([a, b]);
    const exits = [ra.exit, rb.exit].sort();
    expect(dial).toHaveBeenCalledTimes(1);
    expect(exits).toContain("ok");
    expect(exits).toContain("hold");
  });

  it("reserveCue exclusive wx", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-lock-"));
    const event = normalizeEvent(fixture);
    const first = await reserveCue({ dataDir: tmp, event });
    const second = await reserveCue({ dataDir: tmp, event });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (first.ok) await first.reservation.release();
  });
});

describe("structured contradictions + taskCompleted", () => {
  it("rejects structured fields that point at different options", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const parsed = parseStructuredOption(options, {
      option_id: "1",
      decision: "assign_se",
      decision_label: "Take over in chat now",
    });
    expect(parsed.kind).toBe("contradiction");

    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_x",
      structured: {
        option_id: "1",
        decision: "assign_se",
        decision_label: "Take over in chat now",
      },
      taskCompleted: true,
      expectedStageCode: "4821",
    });
    expect(result.decision).toBe("unclear");
  });

  it("accepts CALL-E paraphrased decision id when option_id and label agree", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    // Live 2026-08-12: CALL-E returned decision "takeover" not "take_over_chat"
    const parsed = parseStructuredOption(options, {
      option_id: "1",
      decision: "takeover",
      decision_label: "Take over in chat now",
      stage_code: "4821",
      identity_confirmed: true,
    });
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") expect(parsed.option.option_id).toBe("1");

    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_C5B0fdaDHiR-jiFxMVazdA",
      structured: {
        decision: "takeover",
        option_id: "1",
        stage_code: "4821",
        decision_label: "Take over in chat now",
        identity_confirmed: true,
      },
      taskCompleted: true,
      expectedStageCode: "4821",
      completionConfidence: { score: 0.9, label: "high" },
    });
    expect(result.option_id).toBe("1");
    expect(result.decision).toBe("take_over_chat");
  });

  it("refuses normal decision when taskCompleted is false", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_x",
      structured: {
        option_id: "1",
        decision: "take_over_chat",
        decision_label: "Take over in chat now",
        stage_code: "4821",
        identity_confirmed: true,
      },
      taskCompleted: false,
      expectedStageCode: "4821",
    });
    expect(result.decision).toBe("unclear");
    expect(result.option_id).toBe("unknown");
  });
});

describe("--from-call remap (no ring)", () => {
  let tmp: string;
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("maps an existing CALL-E run without dialing and skips cue-history", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "csvs-remap-"));
    const dial = vi.fn();
    const fetchCall = vi.fn().mockResolvedValue({
      call: {
        id: "call_C5B0fdaDHiR-jiFxMVazdA",
        status: "completed",
        summary:
          "Assaf repeated the stage code and selected option 1: take over in chat now.",
        taskCompleted: true,
        failureCode: null,
        failureMessage: null,
        completionConfidence: { score: 0.9, label: "high" },
        evidence: ["The stage code was repeated correctly."],
        structuredResult: {
          decision: "takeover",
          option_id: "1",
          stage_code: "4821",
          decision_label: "Take over in chat now",
          identity_confirmed: true,
        },
        recipients: [
          {
            structuredResult: null,
            summary: null,
            attempts: [
              {
                transcriptTurns: [
                  { speaker: "user", text: "4 8 2 1." },
                  { speaker: "user", text: "1. 1." },
                ],
              },
            ],
          },
        ],
      },
      structured: {
        decision: "takeover",
        option_id: "1",
        stage_code: "4821",
        decision_label: "Take over in chat now",
        identity_confirmed: true,
      },
      awaited: true,
    });

    const outcome = await runSignal({
      raw: fixture,
      env: baseEnv(tmp),
      liveFlag: false,
      placesTyped: false,
      dryRunFlag: false,
      fromCallId: "call_C5B0fdaDHiR-jiFxMVazdA",
      dial,
      fetchCall,
    });
    expect(dial).not.toHaveBeenCalled();
    expect(fetchCall).toHaveBeenCalledTimes(1);
    expect(outcome.exit).toBe("ok");
    expect(outcome.result?.option_id).toBe("1");
    expect(outcome.result?.decision).toBe("take_over_chat");
    const history = await readFile(path.join(tmp, "cue-history.ndjson"), "utf8").catch(
      () => "",
    );
    expect(history).toBe("");
    const book = await readFile(path.join(tmp, "prompt-book.ndjson"), "utf8");
    expect(book).toMatch(/"option_id":"1"/);
    expect(book).toMatch(/take_over_chat/);
  });
});

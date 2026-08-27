import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEvent } from "../ingest/normalize.js";
import { pickOptions } from "../policy/options.js";
import { buildCallIntent } from "../calle/intent.js";
import {
  checkIdentityReadback,
  digitsFromSpeech,
  stageCodeForEvent,
} from "../calle/stageCode.js";
import { toDecision } from "../map/toDecision.js";
import {
  failureCodesSuggestNoAnswer,
  isLowCompletionConfidence,
} from "../map/sdkOutcome.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(
  readFileSync(path.join(root, "fixtures/stuck_support_acme.json"), "utf8"),
);

describe("stage code + identity read-back", () => {
  it("derives stable 4-digit code from ticket", () => {
    const event = normalizeEvent(fixture);
    expect(stageCodeForEvent(event)).toBe("4821");
  });

  it("parses spoken digit words", () => {
    expect(digitsFromSpeech("four eight two one")).toBe("4821");
    expect(digitsFromSpeech("the code is 4821 thanks")).toBe("4821");
  });

  it("accepts matching structured stage_code", () => {
    const check = checkIdentityReadback({
      expectedStageCode: "4821",
      structured: { stage_code: "4821", identity_confirmed: true },
    });
    expect(check).toEqual({ ok: true, source: "structured" });
  });

  it("rejects mismatch", () => {
    const check = checkIdentityReadback({
      expectedStageCode: "4821",
      structured: { stage_code: "0000", identity_confirmed: true },
    });
    expect(check).toEqual({ ok: false, reason: "mismatch" });
  });

  it("task includes identity read-back and result schema fields", () => {
    const event = normalizeEvent(fixture);
    const intent = buildCallIntent(event, "+14155552671");
    expect(intent.metadata.stage_code).toBe("4821");
    expect(intent.task).toMatch(/Stage code/);
    expect(intent.task).toMatch(/4 8 2 1/);
    expect(intent.result_schema).toMatchObject({
      required: expect.arrayContaining(["stage_code", "identity_confirmed"]),
    });
  });

  it("toDecision refuses 1/2/3 without identity", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_id",
      taskCompleted: true,
      expectedStageCode: "4821",
      structured: {
        option_id: "1",
        decision: "take_over_chat",
        decision_label: "Take over in chat now",
      },
    });
    expect(result.decision).toBe("unclear");
    expect(result.decision_label).toMatch(/identity/i);
  });

  it("toDecision accepts matching identity + option", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_id",
      taskCompleted: true,
      expectedStageCode: "4821",
      completionConfidence: { score: 0.92, label: "high" },
      structured: {
        option_id: "1",
        decision: "take_over_chat",
        decision_label: "Take over in chat now",
        stage_code: "4821",
        identity_confirmed: true,
      },
    });
    expect(result.option_id).toBe("1");
    expect(result.notes_short).toMatch(/identity:stage_code_ok/);
  });
});

describe("SDK outcome helpers", () => {
  it("detects no-answer failure codes", () => {
    expect(failureCodesSuggestNoAnswer("voicemail")).toBe(true);
    expect(failureCodesSuggestNoAnswer("no_answer")).toBe(true);
    expect(failureCodesSuggestNoAnswer("network_error")).toBe(false);
  });

  it("flags low completionConfidence", () => {
    expect(isLowCompletionConfidence({ score: 0.2, label: "low" })).toBe(true);
    expect(isLowCompletionConfidence({ score: 0.9, label: "high" })).toBe(false);
    expect(isLowCompletionConfidence(null)).toBe(false);
  });

  it("toDecision refuses low confidence even with structured option", () => {
    const event = normalizeEvent(fixture);
    const options = pickOptions(event.trigger_id);
    const intent = buildCallIntent(event, "+14155552671", options);
    const result = toDecision({
      event,
      intent,
      options,
      mode: "curtain_up",
      callRunId: "call_id",
      taskCompleted: true,
      expectedStageCode: "4821",
      completionConfidence: { score: 0.2, label: "low" },
      structured: {
        option_id: "1",
        decision: "take_over_chat",
        decision_label: "Take over in chat now",
        stage_code: "4821",
        identity_confirmed: true,
      },
    });
    expect(result.decision).toBe("unclear");
    expect(result.decision_label).toMatch(/completionConfidence/i);
  });
});

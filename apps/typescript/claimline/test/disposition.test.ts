import { describe, expect, it } from "vitest";
import {
  classifyDisposition,
  detectRefusal,
  detectVoicemail,
  type DispositionInput,
} from "../src/domain/disposition.js";

const ok: DispositionInput = {
  status: "completed",
  taskCompleted: true,
  confidenceScore: 0.9,
  confidenceLabel: "high",
  structuredResult: { work_status: "in_progress" },
  schemaValid: true,
};

describe("disposition (fail-closed)", () => {
  it("passes only when every check passes", () => {
    expect(classifyDisposition(ok, 0.6).disposition).toBe("auto_ok");
  });

  it("routes non-completed calls to a human", () => {
    expect(
      classifyDisposition({ ...ok, status: "failed" }, 0.6).disposition,
    ).toBe("needs_human");
  });

  it("routes incomplete tasks to a human", () => {
    expect(
      classifyDisposition({ ...ok, taskCompleted: false }, 0.6).disposition,
    ).toBe("needs_human");
  });

  it("routes missing/invalid structured results to a human", () => {
    expect(
      classifyDisposition({ ...ok, structuredResult: null }, 0.6).disposition,
    ).toBe("needs_human");
    expect(
      classifyDisposition({ ...ok, schemaValid: false }, 0.6).disposition,
    ).toBe("needs_human");
  });

  it("routes low confidence to a human", () => {
    expect(
      classifyDisposition({ ...ok, confidenceScore: 0.4 }, 0.6).disposition,
    ).toBe("needs_human");
    expect(
      classifyDisposition({ ...ok, confidenceLabel: "low" }, 0.6).disposition,
    ).toBe("needs_human");
  });

  it("routes voicemail and refusal to a human", () => {
    expect(
      classifyDisposition({ ...ok, voicemailDetected: true }, 0.6).disposition,
    ).toBe("needs_human");
    expect(
      classifyDisposition({ ...ok, refusalDetected: true }, 0.6).disposition,
    ).toBe("needs_human");
  });
});

describe("signal detection", () => {
  it("detects voicemail from transcript or summary", () => {
    expect(
      detectVoicemail(
        [{ offsetSeconds: 0, speaker: "system", text: "Please leave a message after the tone." }],
        null,
      ),
    ).toBe(true);
    expect(detectVoicemail([], "Reached voicemail; no answer")).toBe(true);
    expect(detectVoicemail([{ offsetSeconds: 0, speaker: "user", text: "Hello?" }], null)).toBe(false);
  });

  it("detects refusal phrases", () => {
    expect(
      detectRefusal([{ offsetSeconds: 0, speaker: "user", text: "Do not call again." }], null),
    ).toBe(true);
    expect(detectRefusal([{ offsetSeconds: 0, speaker: "user", text: "Sure, go ahead." }], null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  REACHED,
  RETRYABLE,
  isReached,
  isRetryable,
  type Disposition,
} from "../src/dispositions";

describe("disposition taxonomy", () => {
  it("does not count voicemail as reached", () => {
    expect(isReached("voicemail_left")).toBe(false);
    expect(isReached("voicemail_no_message")).toBe(false);
    expect(REACHED.has("voicemail_left")).toBe(false);
  });

  it("treats voicemail and no-answer as retryable", () => {
    expect(isRetryable("voicemail_left")).toBe(true);
    expect(isRetryable("no_answer")).toBe(true);
    expect(isRetryable("ivr_dead_end")).toBe(true);
    expect(RETRYABLE.has("answered_declined")).toBe(false);
  });

  it("keeps reached-but-unusable outcomes in the numerator", () => {
    const reachedUnusable: Disposition[] = [
      "answered_declined",
      "answered_unknown",
      "wrong_person",
      "gatekeeper_refused",
      "hung_up",
    ];
    for (const disposition of reachedUnusable) {
      expect(isReached(disposition)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  createOfflineCheckInProgress,
  offlineCheckInDisplayQuestion,
  parseOfflineCheckInProgress,
  OFFLINE_CHECKIN_QUESTION_COUNT,
  OFFLINE_CHECKIN_VERSION,
} from "../lib/offline-checkin";
import { getOfflineDataCopy } from "../lib/offline-data-copy";
import { getOfflineClinicGuidanceTopicCount } from "../lib/offline-clinic-guidance";

describe("offline workflows", () => {
  it("bounds resumable check-in progress to the bundled question pack", () => {
    expect(createOfflineCheckInProgress(-2).completedQuestion).toBe(0);
    expect(createOfflineCheckInProgress(99).completedQuestion).toBe(OFFLINE_CHECKIN_QUESTION_COUNT);
    expect(
      parseOfflineCheckInProgress(
        JSON.stringify({
          version: OFFLINE_CHECKIN_VERSION,
          questionCount: 4,
          completedQuestion: 2,
          savedAt: "2026-08-18T00:00:00.000Z",
        }),
      )?.completedQuestion,
    ).toBe(2);
    expect(offlineCheckInDisplayQuestion(createOfflineCheckInProgress(0))).toBe(1);
  });

  it("keeps bundled clinic and contact guidance available without network", () => {
    expect(getOfflineClinicGuidanceTopicCount()).toBeGreaterThanOrEqual(3);
  });

  it("rejects malformed, stale, or non-integer progress and exposes localized clear-data copy", () => {
    expect(parseOfflineCheckInProgress(JSON.stringify({ completedQuestion: "two" }))).toBeNull();
    expect(
      parseOfflineCheckInProgress(
        JSON.stringify({
          version: OFFLINE_CHECKIN_VERSION,
          questionCount: 4,
          completedQuestion: Number.NaN,
          savedAt: "2026-08-18T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(
      parseOfflineCheckInProgress(
        JSON.stringify({
          version: OFFLINE_CHECKIN_VERSION,
          questionCount: 4,
          completedQuestion: 1.5,
          savedAt: "2026-08-18T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(
      parseOfflineCheckInProgress(
        JSON.stringify({
          version: OFFLINE_CHECKIN_VERSION,
          questionCount: 100,
          completedQuestion: 50,
          savedAt: "2026-08-18T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(
      parseOfflineCheckInProgress(
        JSON.stringify({
          version: "1999.01",
          questionCount: 4,
          completedQuestion: 1,
          savedAt: "2026-08-18T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
    expect(
      parseOfflineCheckInProgress(
        JSON.stringify({
          version: OFFLINE_CHECKIN_VERSION,
          questionCount: 4,
          completedQuestion: 1,
          savedAt: "not-a-date",
        }),
      ),
    ).toBeNull();

    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const copy = getOfflineDataCopy(language);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.locked.length).toBeGreaterThan(0);
    }
  });
});

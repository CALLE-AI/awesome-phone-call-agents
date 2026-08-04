import assert from "node:assert/strict";
import test from "node:test";
import { parseTranscript, readAgreement } from "../src/workflows/appointment-recovery/agreement";
import { classifyOutcome } from "../src/workflows/appointment-recovery/outcome";
import type { ReplacementWindow } from "../src/workflows/appointment-recovery/types";

const TIMEZONE = "Asia/Singapore";
const WINDOWS: ReplacementWindow[] = [
  { start: "2026-08-07T10:00:00+08:00", end: "2026-08-07T12:00:00+08:00" },
  { start: "2026-08-08T15:00:00+08:00", end: "2026-08-08T17:00:00+08:00" },
];

// Verbatim agent-side wording from the Phase 2 de-risking call. The customer
// proposed times outside every approved window and nothing was rebooked.
const OBSERVED_TRANSCRIPT = `[00:00:00] BOT: Hi.
[00:00:05] BOT: I'm calling for Glow and Co.
[00:00:06] BOT: Hair Studio about your missed cut and color appointment yesterday,
[00:00:09] BOT: Monday 3 August at 2 PM, to see if you'd like to rebook for Friday 7 August between 10 AM and noon,
[00:00:15] BOT: or Saturday 8 August between 3 PM and 5 PM,
[00:00:19] BOT: Singapore time.
[00:00:33] USER: It's Friday, 8PM works.
[00:00:36] BOT: Thanks - I'll pass that along.
[00:00:38] BOT: The front desk will follow up.
[00:00:44] USER: Any discounts say I missed it?
[00:00:46] BOT: I can't help with discounts. The front desk will follow up.
[00:00:56] USER: Okay. We don't I will choose Saturday 2PM and SMS confirmation.
[00:00:58] BOT: I'm sorry,
[00:00:59] BOT: I can't confirm Saturday 2 PM because that isn't one of the available windows.
[00:01:03] BOT: I'll pass that along to Glow and Co. Hair Studio.
[00:01:12] BOT: Thank you, bye.`;

const OBSERVED_SUMMARY =
  "The call completed without a valid rebooking. The customer suggested times " +
  "outside the two approved windows, so no appointment was confirmed and the " +
  "front desk will need to follow up if desired.";

test("joins consecutive lines from one speaker into a single utterance", () => {
  const utterances = parseTranscript("[00:00] BOT: I can't\n[00:01] BOT: confirm you for Saturday.");
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].text, "I can't confirm you for Saturday.");
});

// Regression test for the Phase 2 call. A reader that ignored negation would see
// "confirm Saturday 2 PM" and report a booking that never happened.
test("the observed call reads as no valid window, never as an acceptance", () => {
  const reading = readAgreement({
    summary: OBSERVED_SUMMARY,
    transcript: OBSERVED_TRANSCRIPT,
    windows: WINDOWS,
    timezone: TIMEZONE,
  });

  assert.equal(reading.agreement, "no_valid_window");
  assert.equal(reading.matchedWindowIndex, null);
  assert.equal(
    classifyOutcome({ status: "COMPLETED", agreement: reading.agreement }),
    "no_agreement",
  );
});

test("a plain acceptance identifies which window was booked", () => {
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: You're all set. I've confirmed you for Saturday 8 August at 3 PM.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });

  assert.equal(reading.agreement, "accepted_window");
  assert.equal(reading.matchedWindowIndex, 1);
  assert.equal(classifyOutcome({ status: "COMPLETED", agreement: reading.agreement }), "rescheduled");
});

test("distinguishes the first offered window from the second", () => {
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I've confirmed you for Friday 7 August at 10 AM.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(reading.matchedWindowIndex, 0);
});

test("a negated acceptance is not an acceptance, even across split lines", () => {
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I can't\n[00:02] BOT: confirm you for Saturday 8 August at 3 PM.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.notEqual(reading.agreement, "accepted_window");
});

test("an explicit refusal reads as refused", () => {
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: Understood, you're not interested in rebooking. Sorry to bother you.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(reading.agreement, "refused");
  assert.equal(classifyOutcome({ status: "COMPLETED", agreement: reading.agreement }), "declined");
});

test("conflicting refusal and acceptance signals reach a human", () => {
  const reading = readAgreement({
    summary: null,
    transcript:
      "[00:01] BOT: I've confirmed you for Saturday 8 August at 3 PM.\n" +
      "[00:02] USER: Actually no thanks.\n" +
      "[00:03] BOT: You said you're not interested in rebooking.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(reading.agreement, null);
  assert.equal(classifyOutcome({ status: "COMPLETED", agreement: reading.agreement }), "uncertain");
});

test("an acceptance naming no offered window is not guessed at", () => {
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: Great, you're all set.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(reading.agreement, null);
});

// Regression tests for a live call in which the customer confirmed and the app
// still reported `uncertain`. The reader matched a single rendered spelling of
// the hour ("3 PM"), so the phrasings an agent actually uses all missed.
const PHRASINGS: [string, string][] = [
  ["with minutes", "I've confirmed you for Saturday 8 August at 3:00 PM."],
  ["with minutes, no space", "I've confirmed you for Saturday 8 August at 3:00PM."],
  ["a period instead of a colon", "I've confirmed you for Saturday 8 August at 3.00pm."],
  ["punctuated meridiem", "I've confirmed you for Saturday 8 August at 3:00 p.m."],
  ["o'clock", "I've confirmed you for Saturday 8 August at 3 o'clock."],
  ["a part of day", "I've confirmed you for Saturday 8 August at three in the afternoon."],
  ["a 24-hour clock", "I've confirmed you for Saturday 8 August at 15:00."],
  ["a bare hour after 'at'", "I've confirmed you for Saturday 8 August at 3."],
];

for (const [label, sentence] of PHRASINGS) {
  test(`an acceptance stating the time ${label} identifies the window`, () => {
    const reading = readAgreement({
      summary: null,
      transcript: `[00:01] BOT: ${sentence}`,
      windows: WINDOWS,
      timezone: TIMEZONE,
    });
    assert.equal(reading.agreement, "accepted_window", sentence);
    assert.equal(reading.matchedWindowIndex, 1, sentence);
  });
}

test("a stated time that is not the offered one is never read as acceptance", () => {
  for (const sentence of [
    "I've confirmed you for Saturday 8 August at 3:30 PM.", // wrong minute
    "I've confirmed you for Saturday 8 August at 3:00 AM.", // wrong meridiem
    "I've confirmed you for Saturday 8 August at 16:00.", // wrong hour
  ]) {
    const reading = readAgreement({
      summary: null,
      transcript: `[00:01] BOT: ${sentence}`,
      windows: WINDOWS,
      timezone: TIMEZONE,
    });
    assert.notEqual(reading.agreement, "accepted_window", sentence);
  }
});

// "Friday 7 August" must not read as seven o'clock, or a date would book the
// 7 AM window that nobody agreed to.
test("a day number inside a date is not read as an hour", () => {
  const sevenAm: ReplacementWindow[] = [
    { start: "2026-08-09T07:00:00+08:00", end: "2026-08-09T09:00:00+08:00" },
  ];
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I've confirmed you for Sunday 7 August.",
    windows: sevenAm,
    timezone: TIMEZONE,
  });
  assert.notEqual(reading.agreement, "accepted_window");
});

test("keeping the original appointment reads as confirmed, not as uncertain", () => {
  for (const sentence of [
    "Great, I've confirmed your original appointment. See you then.",
    "You're all set - we'll keep it as scheduled.",
    "I've confirmed you for Monday 3 August at 2:00 PM, the same time as before.",
  ]) {
    const reading = readAgreement({
      summary: null,
      transcript: `[00:01] BOT: ${sentence}`,
      windows: WINDOWS,
      timezone: TIMEZONE,
      originalTime: "2026-08-03T14:00:00+08:00",
    });
    assert.equal(reading.agreement, "confirmed_original", sentence);
    assert.equal(
      classifyOutcome({ status: "COMPLETED", agreement: reading.agreement }),
      "confirmed",
      sentence,
    );
  }
});

// An offered window still wins: a reschedule is not a confirmation.
test("an offered window takes precedence over the original slot", () => {
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I've confirmed you for Saturday 8 August at 3:00 PM instead.",
    windows: WINDOWS,
    timezone: TIMEZONE,
    originalTime: "2026-08-03T14:00:00+08:00",
  });
  assert.equal(reading.agreement, "accepted_window");
  assert.equal(reading.matchedWindowIndex, 1);
});

test("a wall-clock window is matched in the operator's own terms, not shifted", () => {
  // No offset, so these digits are the business's own clock. Reading them
  // through the runner's timezone would look for a different hour entirely.
  const wallClock: ReplacementWindow[] = [
    { start: "2026-08-07T10:00", end: "2026-08-07T12:00" },
  ];
  const reading = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I've confirmed you for Friday 7 August at 10:00 AM.",
    windows: wallClock,
    timezone: TIMEZONE,
  });
  assert.equal(reading.agreement, "accepted_window");
  assert.equal(reading.matchedWindowIndex, 0);
});

test("a missing transcript is inconclusive rather than an error", () => {
  const reading = readAgreement({
    summary: null,
    transcript: null,
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(reading.agreement, null);
  assert.deepEqual(reading.evidence, []);
});

test("detects a requested SMS confirmation without inventing one", () => {
  const requested = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I've confirmed you for Saturday 8 August at 3 PM and I'll text you.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(requested.smsRequested, true);

  const silent = readAgreement({
    summary: null,
    transcript: "[00:01] BOT: I've confirmed you for Saturday 8 August at 3 PM.",
    windows: WINDOWS,
    timezone: TIMEZONE,
  });
  assert.equal(silent.smsRequested, null);
});

test("every non-null reading carries the evidence that produced it", () => {
  for (const transcript of [
    "[00:01] BOT: I've confirmed you for Saturday 8 August at 3 PM.",
    "[00:01] BOT: Understood, you're not interested in rebooking.",
    OBSERVED_TRANSCRIPT,
  ]) {
    const reading = readAgreement({ summary: null, transcript, windows: WINDOWS, timezone: TIMEZONE });
    if (reading.agreement !== null) {
      assert.ok(reading.evidence.length > 0, `no evidence for ${reading.agreement}`);
    }
  }
});

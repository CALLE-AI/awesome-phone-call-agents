import assert from "node:assert/strict";
import { test } from "node:test";
import { decideStudent, reduceOutcome, shouldContinueCascade } from "../src/decide.js";
import type { CallOutcome, GuardianAttempt, SchoolConfig } from "../src/types.js";

const school: SchoolConfig = {
  schoolName: "Test School",
  officePhone: "+15550100000",
  safeguardingContact: "Ms. Lead",
  callingWindow: { start: "08:00", end: "11:00" },
  timeZone: "UTC",
  maxGuardiansPerStudent: 3,
  doNotCall: [],
};

function outcome(partial: Partial<CallOutcome>): CallOutcome {
  return {
    callId: "call_1",
    status: "completed",
    structuredResult: null,
    summary: null,
    transcript: [],
    failureCode: null,
    failureMessage: null,
    ...partial,
  };
}

function guardianSays(text: string) {
  return [
    { offset_seconds: 0, speaker: "bot" as const, text: "Were you aware?" },
    { offset_seconds: 3, speaker: "user" as const, text },
  ];
}

test("aware=no is kept only when a guardian turn says so", () => {
  const supported = reduceOutcome(
    outcome({
      structuredResult: {
        answered_by: "guardian",
        guardian_aware: "no",
        reason_category: "guardian_did_not_know",
        expected_return: "",
        callback_requested: "yes",
        guardian_words: "I didn't know",
      },
      transcript: guardianSays("What do you mean? He left for school at seven."),
    }),
  );
  assert.equal(supported.guardianAware, "no");
  assert.match(supported.supportingTurn ?? "", /left for school/);

  const unsupported = reduceOutcome(
    outcome({
      structuredResult: {
        answered_by: "guardian",
        guardian_aware: "no",
        reason_category: "guardian_did_not_know",
        expected_return: "",
        callback_requested: "yes",
        guardian_words: "",
      },
      transcript: guardianSays("Hm, okay."),
    }),
  );
  assert.equal(unsupported.guardianAware, "unknown");
  assert.equal(unsupported.supportingTurn, null);
});

test("aware=yes needs a supporting turn and is not supported by a contradicting one", () => {
  const contradicted = reduceOutcome(
    outcome({
      structuredResult: {
        answered_by: "guardian",
        guardian_aware: "yes",
        reason_category: "illness",
        expected_return: "",
        callback_requested: "no",
        guardian_words: "yes",
      },
      transcript: guardianSays("Yes? No, I did not know she was not at school."),
    }),
  );
  assert.equal(contradicted.guardianAware, "unknown");
  assert.equal(contradicted.reasonCategory, "unknown");
});

test("a non-guardian endpoint never carries an awareness verdict", () => {
  const r = reduceOutcome(
    outcome({
      structuredResult: {
        answered_by: "other_person",
        guardian_aware: "yes",
        reason_category: "illness",
        expected_return: "",
        callback_requested: "yes",
        guardian_words: "she is sick",
      },
      transcript: guardianSays("She is sick, I am the neighbour."),
    }),
  );
  assert.equal(r.answeredBy, "other_person");
  assert.equal(r.guardianAware, "unknown");
  assert.equal(r.callbackRequested, "unknown");
  assert.equal(shouldContinueCascade(r), true);
});

test("failed or null results reduce to no_answer/unknown and continue the cascade", () => {
  const failed = reduceOutcome(outcome({ status: "failed", failureCode: "x", failureMessage: "ring timeout" }));
  assert.equal(failed.answeredBy, "no_answer");
  assert.equal(shouldContinueCascade(failed), true);
  const nullResult = reduceOutcome(outcome({ structuredResult: null }));
  assert.equal(nullResult.answeredBy, "unknown");
  assert.equal(shouldContinueCascade(null), true);
});

function attempt(partial: Partial<GuardianAttempt>): GuardianAttempt {
  return { guardianIndex: 0, maskedPhone: "+1***01", skippedReason: null, outcome: null, reduced: null, ...partial };
}

test("decideStudent: safeguarding alert beats everything and names the human", () => {
  const d = decideStudent(
    [
      attempt({
        reduced: {
          answeredBy: "guardian",
          guardianAware: "no",
          reasonCategory: "guardian_did_not_know",
          expectedReturn: "",
          callbackRequested: "yes",
          supportingTurn: "He left for school",
        },
      }),
    ],
    school,
  );
  assert.equal(d.disposition, "safeguarding_alert");
  assert.match(d.nextAction, /Ms\. Lead/);
  assert.match(d.because, /He left for school/);
});

test("decideStudent: accounted_for quotes the guardian and notes a call-back", () => {
  const d = decideStudent(
    [
      attempt({ skippedReason: "voicemail earlier", reduced: null }),
      attempt({
        guardianIndex: 1,
        reduced: {
          answeredBy: "guardian",
          guardianAware: "yes",
          reasonCategory: "illness",
          expectedReturn: "Wednesday",
          callbackRequested: "yes",
          supportingTurn: "Yes, I know, she has a fever",
        },
      }),
    ],
    school,
  );
  assert.equal(d.disposition, "accounted_for");
  assert.match(d.because, /guardian 2/);
  assert.match(d.because, /fever/);
  assert.match(d.nextAction, /call-back/);
});

test("decideStudent: reached-but-vague is human review, nobody reached is unreached, nobody dialled is not_called", () => {
  const vague = decideStudent(
    [
      attempt({
        reduced: {
          answeredBy: "guardian",
          guardianAware: "unknown",
          reasonCategory: "unknown",
          expectedReturn: "",
          callbackRequested: "unknown",
          supportingTurn: null,
        },
      }),
    ],
    school,
  );
  assert.equal(vague.disposition, "needs_human_review");

  const unreached = decideStudent(
    [
      attempt({
        reduced: {
          answeredBy: "voicemail",
          guardianAware: "unknown",
          reasonCategory: "unknown",
          expectedReturn: "",
          callbackRequested: "unknown",
          supportingTurn: null,
        },
      }),
      attempt({ guardianIndex: 1, skippedReason: "cascade limit of 1 guardian(s) per student reached" }),
    ],
    school,
  );
  assert.equal(unreached.disposition, "unreached");
  assert.match(unreached.because, /voicemail/);

  const notCalled = decideStudent([attempt({ skippedReason: "guardian has not consented to automated attendance calls" })], school);
  assert.equal(notCalled.disposition, "not_called");
  assert.match(notCalled.because, /consented/);
});

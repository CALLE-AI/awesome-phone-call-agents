import assert from "node:assert/strict";
import test from "node:test";
import { attemptOutcome, evaluateAttempt, maskPhone, verdictFromAttempts } from "../src/decide.js";
import type { AttemptEvaluation, CallSnapshot, OutcomeInputs, Policy, TranscriptTurn } from "../src/types.js";
import { approvalRequest, BOB_PHONE, FIXED_SECRET, requestInput } from "./fixtures.js";

const CODE = FIXED_SECRET.code;

function snapshot(options: {
  status?: string;
  botLines?: string[];
  userLines?: string[];
  structured?: Record<string, unknown> | null;
  confidence?: { score: number; label: string } | null;
  failureCode?: string | null;
  attemptStatus?: string;
  /** Unknown, because a provider can put anything in a JSON field. */
  completedAt?: unknown;
}): CallSnapshot {
  const turns: TranscriptTurn[] = [];
  let offset = 0;
  const bot = options.botLines ?? ["This is an automated approval call."];
  const user = options.userLines ?? [];
  for (let index = 0; index < Math.max(bot.length, user.length); index += 1) {
    if (bot[index] !== undefined) {
      turns.push({ offset_seconds: offset, speaker: "bot", text: bot[index]! });
      offset += 4;
    }
    if (user[index] !== undefined) {
      turns.push({ offset_seconds: offset, speaker: "user", text: user[index]! });
      offset += 4;
    }
  }
  const structured = options.structured === undefined ? null : options.structured;
  const completedAt = (
    options.completedAt === undefined ? "2026-07-29T10:01:00Z" : options.completedAt
  ) as string | null;
  return {
    id: "call_test1",
    status: options.status ?? "completed",
    recipients: [
      {
        id: "rcp_1",
        phones: ["+14155550100"],
        status: "completed",
        structuredResult: structured,
        summary: "done",
        attempts: [
          {
            id: "att_1",
            phone: "+14155550100",
            status: options.attemptStatus ?? "completed",
            startedAt: "2026-07-29T10:00:05Z",
            completedAt,
            summary: null,
            transcriptTurns: turns,
            providerCallId: "provider_1",
            failureCode: options.failureCode ?? null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: structured,
    summary: "done",
    taskCompleted: true,
    completionConfidence: options.confidence === undefined ? { score: 0.9, label: "high" } : options.confidence,
    evidence: [],
    failureCode: options.failureCode ?? null,
    failureMessage: null,
    createdAt: "2026-07-29T10:00:00Z",
    completedAt,
  };
}

function evaluate(
  options: Parameters<typeof snapshot>[0] & { withinWindow?: boolean },
  policyOverrides: Partial<Policy> = {},
) {
  const request = approvalRequest();
  const patched = { ...request, policy: { ...request.policy, ...policyOverrides } };
  return evaluateAttempt({
    request: patched,
    approver: patched.approvers[0]!,
    call: snapshot(options),
    code: CODE,
    phrase: FIXED_SECRET.phrase,
    ...(options.withinWindow === undefined ? {} : { withinWindow: options.withinWindow }),
  });
}

test("a person who reads the code back and approves is approved", () => {
  const result = evaluate({
    userLines: ["Four seven two nine one three, I approve."],
    structured: { decision: "approve", spoken_code: "472913", reason: "Said approve." },
  });
  assert.equal(result.outcome, "approved");
  assert.equal(result.reason, null);
  assert.equal(result.evidence.code_match, true);
  assert.equal(result.spoken_secret_digest, result.secret_digest);
});

test("the code is redacted out of the stored excerpt", () => {
  const result = evaluate({
    userLines: ["Four seven two nine one three, I approve."],
    structured: { decision: "approve", spoken_code: "472913", reason: "ok" },
  });
  assert.equal(result.transcript_excerpt.join(" ").includes(CODE), false);
  assert.match(result.transcript_excerpt.join(" "), /\[code\]/);
  assert.match(result.transcript_excerpt.join(" "), /approve/);
});

test("a code this run does not hold is a mismatch, not an approval", () => {
  const result = evaluate({
    userLines: ["Four seven two nine one four. Approved."],
    structured: { decision: "approve", spoken_code: "472914", reason: "ok" },
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "code_mismatch");
  assert.equal(result.evidence.unmatched_code_spoken, true);
  assert.notEqual(result.spoken_secret_digest, result.secret_digest);
  assert.notEqual(result.spoken_secret_digest, null);
  // The code that came back is not this run's, so it is not stored either.
  assert.match(result.transcript_excerpt.join(" "), /\[digits\]/);
  assert.match(result.transcript_excerpt.join(" "), /Approved/);
});

test("a yes with no code at all is a secret that never came back", () => {
  const result = evaluate({
    userLines: ["Yeah sure, go ahead, ship it."],
    structured: { decision: "approve", spoken_code: "", reason: "Said go ahead." },
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "secret_not_returned");
  assert.equal(result.evidence.unmatched_code_spoken, false);
  assert.equal(result.spoken_secret_digest, null);
});

test("a rejection is recorded as a rejection", () => {
  const result = evaluate({
    userLines: ["No, reject that."],
    structured: { decision: "reject", spoken_code: "", reason: "Said reject." },
  });
  assert.equal(result.outcome, "rejected");
});

test("an extracted result that contradicts the transcript fails closed", () => {
  const result = evaluate({
    userLines: ["472913. I approve."],
    structured: { decision: "unknown", spoken_code: "472913", reason: "unclear" },
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "disagreement");
});

test("low completion confidence blocks an approval", () => {
  const result = evaluate({
    userLines: ["472913, approved."],
    structured: { decision: "approve", spoken_code: "472913", reason: "ok" },
    confidence: { score: 0.2, label: "low" },
  });
  assert.equal(result.reason, "low_confidence");
});

test("voicemail never approves", () => {
  const result = evaluate({
    userLines: ["Please leave a message after the tone."],
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "voicemail");
});

test("a completed call where nobody spoke is not_reached", () => {
  const result = evaluate({ userLines: [] });
  assert.equal(result.reason, "not_reached");
});

test("a missing transcript blocks approval, whatever the extracted result says", () => {
  const result = evaluate({
    botLines: [],
    userLines: [],
    structured: { decision: "approve", spoken_code: "472913", reason: "ok" },
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "no_transcript_evidence");
  assert.equal(result.evidence.transcript_available, false);
  // The extraction claimed a person and a code. Neither is evidence on its own.
  assert.equal(result.evidence.reached_person, false);
  assert.equal(result.evidence.code_match, false);
  assert.equal(result.spoken_secret_digest, null);
});

test("a completed call with no usable completion time refuses with its own reason", () => {
  // A provider that sends no completion time, an empty one or the wrong type
  // leaves the gate unable to tell a fresh decision from an idempotent replay of
  // an old call, so it refuses and says which of the two checks failed.
  for (const completedAt of [null, undefined, "", "not a date", 42, {}]) {
    const result = evaluate({
      userLines: ["Four seven two nine one three, I approve."],
      structured: { decision: "approve", spoken_code: "472913", reason: "ok" },
      completedAt: completedAt === undefined ? null : completedAt,
    });
    assert.equal(result.outcome, "not_approved", String(completedAt));
    assert.equal(result.reason, "completion_time_unknown", String(completedAt));
    assert.equal(result.evidence.completion_time_usable, false);
    assert.equal(result.evidence.within_window, false);
  }
});

test("a decision that landed outside the window cannot approve", () => {
  const late = evaluate({
    userLines: ["Four seven two nine one three, I approve."],
    structured: { decision: "approve", spoken_code: "472913", reason: "ok" },
    withinWindow: false,
  });
  assert.equal(late.outcome, "not_approved");
  assert.equal(late.reason, "window_expired");
  assert.equal(late.evidence.within_window, false);

  // A rejection still counts. Nothing is safer than honouring a no.
  const rejected = evaluate({
    userLines: ["No, reject that."],
    structured: { decision: "reject", spoken_code: "", reason: "Said reject." },
    withinWindow: false,
  });
  assert.equal(rejected.outcome, "rejected");
});

test("a call whose state could not be settled is recorded as unknown, not as a failure", () => {
  const request = approvalRequest();
  const result = evaluateAttempt({
    request,
    approver: request.approvers[0]!,
    call: null,
    code: CODE,
    phrase: FIXED_SECRET.phrase,
    apiErrorCode: "service_unavailable",
    callStateUnknown: true,
    callId: "call_maybe",
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "call_state_unknown");
  assert.equal(result.evidence.call_status, "state_unknown");
  assert.equal(result.call_id, "call_maybe");
});

test("failure codes map to the reason an operator needs", () => {
  assert.equal(evaluate({ status: "failed", failureCode: "no_answer" }).reason, "no_answer");
  assert.equal(evaluate({ status: "failed", failureCode: "voicemail_detected" }).reason, "voicemail");
  assert.equal(evaluate({ status: "failed", failureCode: "carrier_error" }).reason, "call_failed");
});

test("a status that is not terminal resolves nothing, whatever else the call says", () => {
  // Every one of these read back a call that may still be talking to the
  // approver. An approval in the transcript cannot settle it and neither can a
  // clean failure, so the attempt stays unresolved and the ladder stops. The last
  // three are not CALL-E statuses at all: a no answer, a busy line and a
  // voicemail arrive as failed with a failure code, so a status spelled that way
  // is something this gate does not understand.
  for (const status of [
    "queued",
    "scheduled",
    "ringing",
    "in_progress",
    "dialing",
    "surprise",
    "no_answer",
    "busy",
    "voicemail",
  ]) {
    const result = evaluate({
      status,
      userLines: ["Four seven two nine one three, I approve."],
      structured: { decision: "approve", spoken_code: "472913", reason: "ok" },
    });
    assert.equal(result.outcome, "not_approved", status);
    assert.equal(result.reason, "call_state_unknown", status);
  }
});

test("an API failure with no call is recorded, not swallowed", () => {
  const request = approvalRequest();
  const result = evaluateAttempt({
    request,
    approver: request.approvers[0]!,
    call: null,
    code: CODE,
    phrase: FIXED_SECRET.phrase,
    apiErrorCode: "insufficient_balance",
  });
  assert.equal(result.outcome, "not_approved");
  assert.equal(result.reason, "api_error");
  assert.equal(result.evidence.failure_code, "insufficient_balance");
});

test("phone numbers are masked wherever they are shown", () => {
  assert.equal(maskPhone("+14155550100"), "+14*******00");
  assert.equal(maskPhone("+123"), "***");
});

const singlePolicy = approvalRequest().policy;
const dualPolicy: Policy = { ...singlePolicy, mode: "dual" };

function attempt(id: string, outcome: AttemptEvaluation["outcome"], reason: AttemptEvaluation["reason"] = null): AttemptEvaluation {
  const evidence: OutcomeInputs = {
    call_status: "completed",
    failure_code: null,
    reached_person: true,
    machine_answered: false,
    within_window: true,
    completion_time_usable: true,
    transcript_available: true,
    code_match: outcome === "approved",
    unmatched_code_spoken: false,
    decision: outcome === "approved" ? "approve" : outcome === "rejected" ? "reject" : "unknown",
    structured_decision: null,
    confidence: { score: 0.9, label: "high" },
  };
  return {
    approver_id: id,
    phone_masked: "+14*******00",
    call_id: `call_${id}`,
    provider_call_id: null,
    outcome,
    reason,
    evidence,
    secret_digest: "sha256:aa",
    spoken_secret_digest: outcome === "approved" ? "sha256:aa" : null,
    transcript_excerpt: [],
    started_at: null,
    completed_at: null,
  };
}

test("single control needs one approval", () => {
  const folded = verdictFromAttempts([attempt("alice", "approved")], singlePolicy);
  assert.equal(folded.verdict, "approved");
  assert.deepEqual(folded.approvedBy, ["alice"]);
});

test("dual control needs two different approvers", () => {
  const one = verdictFromAttempts([attempt("alice", "approved")], dualPolicy);
  assert.equal(one.verdict, "not_approved");
  assert.equal(one.reason, "quorum_not_met");

  const two = verdictFromAttempts(
    [attempt("alice", "approved"), attempt("bob", "approved")],
    dualPolicy,
  );
  assert.equal(two.verdict, "approved");
  assert.deepEqual(two.approvedBy, ["alice", "bob"]);
});

test("one rejection outranks any approval in the ladder", () => {
  const folded = verdictFromAttempts(
    [attempt("alice", "approved"), attempt("bob", "rejected")],
    dualPolicy,
  );
  assert.equal(folded.verdict, "rejected");
  assert.deepEqual(folded.approvedBy, []);
});

test("with nothing but failures the last reason is reported", () => {
  const folded = verdictFromAttempts(
    [attempt("alice", "not_approved", "no_answer"), attempt("bob", "not_approved", "voicemail")],
    singlePolicy,
  );
  assert.equal(folded.verdict, "not_approved");
  assert.equal(folded.reason, "voicemail");
});

test("outcome inputs alone decide the outcome, which is what verification replays", () => {
  const inputs: OutcomeInputs = {
    call_status: "completed",
    failure_code: null,
    reached_person: true,
    machine_answered: false,
    within_window: true,
    completion_time_usable: true,
    transcript_available: true,
    code_match: true,
    unmatched_code_spoken: false,
    decision: "approve",
    structured_decision: "approve",
    confidence: { score: 0.9, label: "high" },
  };
  assert.equal(attemptOutcome(inputs, singlePolicy).outcome, "approved");
  assert.equal(
    attemptOutcome({ ...inputs, code_match: false }, singlePolicy).reason,
    "secret_not_returned",
  );
  assert.equal(
    attemptOutcome({ ...inputs, code_match: false, unmatched_code_spoken: true }, singlePolicy).reason,
    "code_mismatch",
  );
  assert.equal(attemptOutcome({ ...inputs, decision: "unknown" }, singlePolicy).reason, "no_decision");
  assert.equal(attemptOutcome({ ...inputs, decision: "reject" }, singlePolicy).outcome, "rejected");
  assert.equal(attemptOutcome({ ...inputs, within_window: false }, singlePolicy).reason, "window_expired");
  assert.equal(
    attemptOutcome({ ...inputs, within_window: false, completion_time_usable: false }, singlePolicy)
      .reason,
    "completion_time_unknown",
  );
  assert.equal(
    attemptOutcome({ ...inputs, call_status: "state_unknown" }, singlePolicy).reason,
    "call_state_unknown",
  );
  assert.equal(attemptOutcome({ ...inputs, call_status: "api_error" }, singlePolicy).reason, "api_error");
});

test("a request with two approvers keeps them in ladder order", () => {
  const first = requestInput().approvers[0]!;
  const request = approvalRequest({
    approvers: [first, { ...first, id: "bob", name: "Bob", phone: BOB_PHONE }],
  });
  assert.deepEqual(
    request.approvers.map((approver) => approver.id),
    ["alice", "bob"],
  );
});

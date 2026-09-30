import { test } from "node:test";
import assert from "node:assert/strict";
import type { Call } from "@call-e/calle";
import { CLOSING_LINE, buildResultSchema, buildTask, OPENING_LINE } from "../lib/calle";
import { formatOffset, matchEvidence, normalizeCall, readAnswer } from "../lib/call-record";
import {
  buildResultView,
  buildTrail,
  factNeed,
  factTopic,
  getReveal,
  primaryClarification,
} from "../lib/result";
import demo from "../fixtures/demo-run.json" with { type: "json" };
import type { Clarification, Session } from "../lib/types";

const CLARIFICATIONS = demo.clarifications as Clarification[];
const PRIMARY = CLARIFICATIONS[0]!;

const record = normalizeCall(demo.call as unknown as Call);

function sessionWith(call = record): Session {
  return {
    id: "s1",
    createdAt: new Date().toISOString(),
    replay: true,
    application: { jobDescription: "", resume: "", answers: "" },
    clarifications: CLARIFICATIONS,
    callId: call.callId,
    call,
  };
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

test("the task brief opens with the locked line, verbatim", () => {
  const task = buildTask(PRIMARY);
  assert.ok(task.includes(`"${OPENING_LINE}"`));
  assert.ok(task.includes("word for word"));
});

test("the task brief carries the one claim, its question and its fallback probes", () => {
  const task = buildTask(PRIMARY);
  assert.ok(task.includes(PRIMARY.claim), "missing the claim");
  assert.ok(task.includes(PRIMARY.question), "missing the spoken question");
  for (const probe of PRIMARY.probes) assert.ok(task.includes(probe), `missing probe: ${probe}`);
});

/**
 * The call clarifies one thing. A brief that mentions the runners-up invites
 * the caller to work through them, which is the phone interview this product
 * is deliberately not.
 */
test("the task brief never mentions a claim other than the one being called about", () => {
  const task = buildTask(PRIMARY);
  for (const other of CLARIFICATIONS.slice(1)) {
    assert.ok(!task.includes(other.claim), `the brief leaked a secondary claim: ${other.claim}`);
    assert.ok(!task.includes(other.question), `the brief leaked a secondary question`);
  }
});

test("the task brief demands exactly one follow-up, chosen from the answer", () => {
  const task = buildTask(PRIMARY);
  // The whole demo turns on the second question being unpredictable in advance.
  assert.match(task, /THEN ASK EXACTLY ONE FOLLOW-UP, AND CHOOSE IT FROM WHAT THEY JUST SAID/);
  assert.match(task, /not scripted/i);
  assert.match(task, /ask for their own figure or their own part/i);
});

test("the task brief keeps the call short and says how to end it", () => {
  const task = buildTask(PRIMARY);
  assert.match(task, /two-question call/i);
  assert.match(task, /Ask two questions/i);
  assert.ok(task.includes(CLOSING_LINE), "the brief must name the closing line");
  assert.match(task, /This is not an interview/i);
});

test("the task brief forbids compound questions", () => {
  // Live run 3 asked "Who owned the fix overall, and how long were you
  // involved?" and got one answer to neither half.
  const task = buildTask(PRIMARY);
  assert.match(task, /Ask exactly one thing at a time/i);
  assert.match(task, /Never join two questions with "and"/i);
});

test("the task brief names the candidate and the role when both are known", () => {
  const task = buildTask(PRIMARY, {
    candidateName: "Devan Mistry",
    roleTitle: "Cloud Support Engineer",
  });
  assert.ok(task.includes("Devan Mistry"));
  assert.ok(task.includes("Cloud Support Engineer"));
});

test("the task brief instructs an exit when consent is refused", () => {
  assert.match(buildTask(PRIMARY), /not a good time.*end the call/s);
});

// ---------------------------------------------------------------------------
// The result schema
// ---------------------------------------------------------------------------

test("the result schema is one strict object for the one claim", () => {
  const schema = buildResultSchema(PRIMARY);
  assert.deepEqual(schema.required, ["c1"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ["c1"]);

  const c1 = schema.properties.c1;
  assert.equal(c1.type, "object");
  assert.equal(c1.additionalProperties, false);
  assert.deepEqual(c1.required, [
    "corrected",
    "correction",
    "basis",
    "headline",
    "answer",
    "specifics",
    "still_unclear",
    "open_question",
    "quote",
    "confidence",
  ]);
  assert.deepEqual(c1.properties.confidence.enum, ["high", "medium", "low"]);
  // CALL-E rejects $ref/oneOf/anyOf/allOf — the schema must be fully inlined.
  assert.ok(!JSON.stringify(schema).includes("$ref"));
});

test("the schema asks for the three lines the reveal is built from", () => {
  const fields = buildResultSchema(PRIMARY).properties.c1!.properties;
  // BEFORE is the topic, so AFTER has to be told what it is replacing.
  assert.ok(fields.corrected.description.includes(PRIMARY.topic!));
  assert.match(fields.corrected.description, /at most five words/i);
  assert.match(fields.correction.description, /at most eight words/i);
  assert.match(fields.basis.description, /at most six words/i);
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test("a CALL-E response normalizes into the domain record", () => {
  assert.equal(record.callId, "call_demo_cloud_support");
  assert.equal(record.status, "completed");
  assert.equal(record.attemptStatus, "completed");
  assert.equal(record.transcript.length, 8);
  assert.equal(record.taskCompleted, true);
  assert.equal(record.completionConfidence?.label, "high");
  assert.equal(record.taskEvidence.length, 2);
  assert.deepEqual(record.transcript[0], {
    offsetSeconds: 2,
    speaker: "bot",
    text: demo.call.recipients[0]!.attempts[0]!.transcriptTurns[0]!.text,
  });
});

test("structured result reads back the reveal fields", () => {
  const answer = readAnswer(record.structuredResult, "c1");
  assert.equal(answer?.corrected, "96% personal");
  assert.equal(answer?.correction, "98% was the team metric");
  assert.equal(answer?.basis, "45 surveys");
  assert.equal(answer?.confidence, "high");
  assert.equal(readAnswer(record.structuredResult, "nope"), null);
  assert.equal(readAnswer(null, "c1"), null);
});

test("an unknown confidence value degrades to low rather than throwing", () => {
  const answer = readAnswer({ c1: { answer: "a", confidence: "certain" } }, "c1");
  assert.equal(answer?.confidence, "low");
});

test("a record predating the reveal fields reads back as empty, not undefined", () => {
  const answer = readAnswer({ c1: { answer: "a", confidence: "high" } }, "c1");
  assert.equal(answer?.corrected, "");
  assert.equal(answer?.correction, "");
  assert.equal(answer?.basis, "");
  assert.equal(answer?.open_question, "");
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

test("a quote is matched back onto the candidate's turn and carries its timestamp", () => {
  const evidence = matchEvidence(
    "Ninety-six percent. That was across about forty-five surveys that came back.",
    record.transcript,
  );
  assert.equal(evidence?.offsetSeconds, 40);
  assert.equal(formatOffset(evidence!.offsetSeconds), "00:40");
  assert.equal(record.transcript[evidence!.turnIndex]!.speaker, "user");
});

test("a lightly cleaned-up quote still matches its turn", () => {
  const evidence = matchEvidence(
    "ninety-six percent, across about forty-five surveys",
    record.transcript,
  );
  assert.equal(evidence?.offsetSeconds, 40);
});

test("evidence never attributes the caller's words to the candidate", () => {
  const botLine = record.transcript.find((t) => t.speaker === "bot")!.text;
  const evidence = matchEvidence(botLine, record.transcript);
  assert.equal(evidence?.turnIndex, -1, "a bot line must not match a candidate turn");
});

test("an unmatchable quote is kept but carries no timestamp", () => {
  const evidence = matchEvidence("Something never said on this call at all", record.transcript);
  assert.equal(evidence?.turnIndex, -1);
  assert.equal(evidence?.offsetSeconds, null);
});

test("an empty quote produces no evidence", () => {
  assert.equal(matchEvidence("", record.transcript), null);
  assert.equal(matchEvidence("   ", record.transcript), null);
});

test("offsets format as mm:ss, and null stays null", () => {
  assert.equal(formatOffset(134), "02:14");
  assert.equal(formatOffset(0), "00:00");
  assert.equal(formatOffset(null), null);
  assert.equal(formatOffset(-1), null);
});

// ---------------------------------------------------------------------------
// The result view
// ---------------------------------------------------------------------------

test("the call clarifies the top-ranked claim and nothing else", () => {
  assert.equal(primaryClarification(sessionWith())!.claim, "Maintained 98% CSAT");
  assert.deepEqual(Object.keys(record.structuredResult ?? {}), ["c1"]);
});

test("the result view is one fact, backed by one quote", () => {
  const view = buildResultView(sessionWith());
  assert.equal(view.fact!.clarification.id, "c1");
  assert.equal(view.fact!.evidence?.offsetSeconds, 40);
  assert.match(view.fact!.answer!.answer, /queue average/);
});

test("the reveal is the 98% → 96% transformation, in four short lines", () => {
  const reveal = getReveal(buildResultView(sessionWith()).fact!);
  assert.equal(reveal.before, "98% CSAT");
  assert.equal(reveal.after, "96% personal");
  assert.equal(reveal.correction, "98% was the team metric");
  assert.equal(reveal.basis, "45 surveys");
  assert.equal(reveal.answered, true);
  // Honest about what one call did not settle.
  assert.equal(reveal.stillUnclear, "What period does the 96% cover?");
});

test("a resolved answer leaves nothing hanging on the reveal", () => {
  const fact = buildResultView(sessionWith()).fact!;
  const reveal = getReveal({
    ...fact,
    answer: { ...fact.answer!, still_unclear: "Nothing.", open_question: "" },
  });
  assert.equal(reveal.stillUnclear, null);
});

test("a record predating the reveal fields still produces an AFTER line", () => {
  const fact = buildResultView(sessionWith()).fact!;
  const reveal = getReveal({
    ...fact,
    answer: {
      ...fact.answer!,
      corrected: "",
      correction: "",
      basis: "",
      headline: "The candidate said that ninety-six percent, on forty-five surveys",
    },
  });
  assert.equal(reveal.after, "Ninety-six percent");
  assert.equal(reveal.correction, null);
  assert.equal(reveal.basis, null);
});

test("a call with no structured result reveals nothing rather than inventing it", () => {
  const view = buildResultView(sessionWith({ ...record, structuredResult: null }));
  assert.equal(view.fact!.answer, null);
  const reveal = getReveal(view.fact!);
  assert.equal(reveal.before, "98% CSAT");
  assert.equal(reveal.answered, false);
});

test("a session with nothing to clarify produces no fact and no trail", () => {
  const view = buildResultView({ ...sessionWith(), clarifications: [] });
  assert.equal(view.fact, null);
  assert.deepEqual(view.trail, []);
});

// ---------------------------------------------------------------------------
// The trail — the adaptive follow-up is the whole point
// ---------------------------------------------------------------------------

test("the trail is question, answer, adaptive follow-up, answer", () => {
  const { trail } = buildResultView(sessionWith());
  assert.deepEqual(
    trail.map((step) => step.kind),
    ["asked", "answered", "followUp", "answered"],
  );
  assert.match(trail[0]!.text, /Was that your own score or the team's\?/);
  assert.match(trail[1]!.text, /the team's score/);
  assert.match(trail[2]!.text, /What was your own score\?/);
  assert.match(trail[3]!.text, /Ninety-six percent/);
});

test("the trail skips the consent exchange, which says nothing about this call", () => {
  const { trail } = buildResultView(sessionWith());
  assert.ok(!trail.some((step) => step.text.includes(OPENING_LINE)));
  assert.ok(!trail.some((step) => step.text.includes("Go ahead")));
  assert.equal(trail[0]!.turnIndex, 2);
});

test("the trail stops at the sign-off, so a goodbye is never read as a follow-up", () => {
  const { trail } = buildResultView(sessionWith());
  assert.ok(!trail.some((step) => step.text.includes(CLOSING_LINE)));
  assert.ok(!trail.some((step) => step.text === "No problem. Thanks."));
});

test("the evidence quote lands on a turn the trail already shows", () => {
  const view = buildResultView(sessionWith());
  const turns = view.trail.map((step) => step.turnIndex);
  assert.ok(turns.includes(view.fact!.evidence!.turnIndex));
});

test("the trail survives a caller that rephrases the written question", () => {
  const trail = buildTrail(PRIMARY, [
    { offsetSeconds: 0, speaker: "bot", text: OPENING_LINE },
    { offsetSeconds: 5, speaker: "user", text: "Sure, go ahead." },
    {
      offsetSeconds: 9,
      speaker: "bot",
      text: "So the ninety-eight percent CSAT figure — is that your score, or the team's?",
    },
    { offsetSeconds: 18, speaker: "user", text: "That's the team's." },
    { offsetSeconds: 22, speaker: "bot", text: "And yours?" },
    { offsetSeconds: 25, speaker: "user", text: "Ninety-six." },
  ]);
  assert.deepEqual(
    trail.map((step) => step.kind),
    ["asked", "answered", "followUp", "answered"],
  );
});

/**
 * The consent exchange is the only reliably fixed part of a call. When word
 * matching fails outright, starting after it is still right; starting at turn
 * zero would put the greeting in the trail as the question we asked.
 */
test("a question that matches no turn still starts the trail after the greeting", () => {
  const trail = buildTrail(PRIMARY, [
    { offsetSeconds: 0, speaker: "bot", text: OPENING_LINE },
    { offsetSeconds: 5, speaker: "user", text: "Sure." },
    { offsetSeconds: 8, speaker: "bot", text: "Whose figure was it?" },
    { offsetSeconds: 14, speaker: "user", text: "The team's." },
  ]);
  assert.equal(trail.length, 2);
  assert.equal(trail[0]!.turnIndex, 2);
});

test("a call with no transcript has no trail at all", () => {
  assert.deepEqual(buildTrail(PRIMARY, []), []);
  assert.deepEqual(buildResultView(sessionWith({ ...record, transcript: [] })).trail, []);
});

test("a question asked but never answered leaves no dangling step", () => {
  const trail = buildTrail(PRIMARY, [
    { offsetSeconds: 0, speaker: "bot", text: OPENING_LINE },
    { offsetSeconds: 5, speaker: "user", text: "Sure." },
    { offsetSeconds: 8, speaker: "bot", text: PRIMARY.question },
  ]);
  assert.deepEqual(trail, []);
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("every seeded claim carries a short topic label and a one-line ambiguity", () => {
  for (const clarification of CLARIFICATIONS) {
    const topic = factTopic(clarification);
    assert.ok(topic, `${clarification.id} has no topic`);
    assert.ok(topic.split(/\s+/).length <= 4, `${clarification.id} topic is too long to scan`);
    // A topic that restates the claim is not a label.
    assert.notEqual(topic, clarification.claim);

    const need = factNeed(clarification);
    assert.ok(need.endsWith("?"), `${clarification.id} need is not a question`);
    assert.ok(need.split(/\s+/).length <= 12, `${clarification.id} need is too long to read`);
  }
  assert.deepEqual(CLARIFICATIONS.map(factTopic), [
    "98% CSAT",
    "Production incidents",
    "Sev-1 incidents",
  ]);
});

test("a claim stored before these labels existed still renders", () => {
  const { topic, need, ...bare } = CLARIFICATIONS[1]!;
  assert.equal(factTopic(bare), "Resolved critical production incidents…");
  assert.equal(factTopic({ ...bare, claim: "Handled Sev-1 incidents" }), "Handled Sev-1 incidents");
  // With no `need`, the spoken question is the next best thing to show.
  assert.equal(factNeed(bare), bare.question);
});

// ---------------------------------------------------------------------------
// Failure normalization
// ---------------------------------------------------------------------------

test("normalization keeps the attempt's wire-level failure code over the call's roll-up", () => {
  // The real shape of a declined call: the call level says only that it failed,
  // while the attempt carries the SIP code that says why. Keeping `call_failed`
  // would throw away the only field that can be diagnosed.
  const declined = {
    id: "call_declined",
    status: "failed",
    recipients: [
      {
        id: "r1",
        phones: ["+15555550100"],
        locale: null,
        region: null,
        status: "failed",
        structuredResult: null,
        summary: null,
        attempts: [
          {
            id: "a1",
            phone: "+15555550100",
            status: "failed",
            startedAt: "2026-09-05T16:51:57",
            completedAt: "2026-09-05T16:51:57",
            summary: null,
            transcriptTurns: [],
            providerCallId: "p1",
            failureCode: "603",
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: false,
    completionConfidence: null,
    evidence: [],
    metadata: {},
    failureCode: "call_failed",
    failureMessage: "calling task status=DECLINED (Hangup by: user)",
    createdAt: "2026-09-05T20:51:03Z",
    completedAt: "2026-09-05T20:52:34Z",
  } as unknown as Call;

  const normalized = normalizeCall(declined);
  assert.equal(normalized.failureCode, "603");
  // The call-level message is the only one populated, so it must survive the swap.
  assert.equal(normalized.failureMessage, "calling task status=DECLINED (Hangup by: user)");
});

test("a failure with no attempt still reports the call-level code", () => {
  const noAttempt = {
    id: "call_never_dialed",
    status: "failed",
    recipients: [],
    structuredResult: null,
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    metadata: {},
    failureCode: "invalid_recipient",
    failureMessage: "no dialable number",
    createdAt: "2026-09-05T20:51:03Z",
    completedAt: null,
  } as unknown as Call;

  const normalized = normalizeCall(noAttempt);
  assert.equal(normalized.failureCode, "invalid_recipient");
  assert.equal(normalized.failureMessage, "no dialable number");
});

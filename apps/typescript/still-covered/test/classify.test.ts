import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POLICY, HARD_CALL_CAP, nextAction } from "../src/cascade.js";
import { classifyScreening } from "../src/classify.js";
import type { Answer, AskableCode, ScreeningResult } from "../src/types.js";

type Overrides = Partial<Omit<ScreeningResult, "answers">> & { answers?: Partial<Record<AskableCode, Answer>> };

function result(o: Overrides = {}): ScreeningResult {
  const answers: Record<AskableCode, Answer> = {
    caregiver_child: "no",
    pregnant_postpartum: "no",
    caregiver_disabled: "no",
    medically_frail: "no",
    snap_tanf: "no",
    veteran_disability: "no",
    sud_treatment: "no",
    former_foster_youth: "not_asked",
    ...(o.answers ?? {}),
  };
  const { answers: _ignored, ...rest } = o;
  return {
    call_outcome: "completed",
    identity_confirmed: "yes",
    aware_of_rule: "no",
    frail_daily_limitation: "not_asked",
    monthly_hours: 20,
    income_band: "under_580",
    agent_told_them: "needs_help",
    wants_navigator: "yes",
    preferred_callback: "",
    opt_out: "no",
    notes: "",
    ...rest,
    answers,
  };
}

function recipient(r: ScreeningResult | null, status: "completed" | "failed" = "completed") {
  return {
    status,
    structuredResult: r as unknown as Record<string, unknown> | null,
    attempts: [{ id: "att_1", phone: "+14155550301", status, startedAt: null, completedAt: null, summary: null, transcriptTurns: [], providerCallId: null, failureCode: status === "failed" ? "no_answer" : null, failureMessage: null }],
  };
}

const classify = (r: ScreeningResult | null, confidence: string | null = "high", status: "completed" | "failed" = "completed") =>
  classifyScreening({ recipient: recipient(r, status), confidenceLabel: confidence, hoursPerMonth: 80 });

test("a failed attempt is unreachable, whatever the result says", () => {
  const c = classify(result(), "high", "failed");
  assert.equal(c.outcome, "unreachable");
  assert.ok(c.reasons[0]?.includes("no_answer"));
});

test("a completed call with no structured result is unverified", () => {
  assert.equal(classify(null).outcome, "unverified");
});

test("asking not to be called again wins over everything, even an exemption", () => {
  assert.equal(classify(result({ opt_out: "yes", answers: { caregiver_child: "yes" } })).outcome, "opted_out");
});

test("voicemail is not reached; a wrong person or an unconfirmed identity means nothing was discussed", () => {
  assert.equal(classify(result({ call_outcome: "voicemail", identity_confirmed: "unknown" })).outcome, "unreachable");
  assert.equal(classify(result({ call_outcome: "wrong_person", identity_confirmed: "no" })).outcome, "identity_unconfirmed");
  assert.equal(classify(result({ identity_confirmed: "unknown", answers: { caregiver_child: "yes" } })).outcome, "identity_unconfirmed", "answers never count without a confirmed identity");
});

test("declined and cut-short calls are not screenings", () => {
  assert.equal(classify(result({ call_outcome: "declined_now" })).outcome, "declined");
  assert.equal(classify(result({ call_outcome: "cut_short" })).outcome, "unverified");
});

test("one exemption answer of yes is enough for may-qualify", () => {
  const c = classify(result({ answers: { caregiver_child: "yes" }, agent_told_them: "may_qualify_exemption" }));
  assert.equal(c.outcome, "likely_exempt");
  assert.deepEqual(c.exemptions, ["caregiver_child"]);
  assert.equal(c.correctionNeeded, false);
});

test("medical frailty needs a condition AND a limit on daily activities", () => {
  assert.deepEqual(classify(result({ answers: { medically_frail: "yes" }, frail_daily_limitation: "yes" })).exemptions, ["medically_frail"]);
  assert.equal(classify(result({ answers: { medically_frail: "yes" }, frail_daily_limitation: "no" })).outcome, "needs_review");
  assert.equal(classify(result({ answers: { medically_frail: "yes" }, frail_daily_limitation: "unknown" })).outcome, "needs_review");
});

test("80 hours or $580 a month means may already meet the requirement", () => {
  assert.equal(classify(result({ monthly_hours: 80 })).outcome, "likely_meets");
  assert.equal(classify(result({ monthly_hours: -1, income_band: "580_or_more" })).outcome, "likely_meets");
});

test("every exemption answered no and hours known to be short is at risk", () => {
  const c = classify(result({ monthly_hours: 40 }));
  assert.equal(c.outcome, "at_risk");
  assert.ok(c.reasons[0]?.includes("40 hours"));
});

test("anything unclear goes to a navigator, never to 'fine'", () => {
  assert.equal(classify(result({ answers: { snap_tanf: "unknown" }, monthly_hours: 40 })).outcome, "needs_review");
  assert.equal(classify(result({ monthly_hours: -1, income_band: "unknown" })).outcome, "needs_review");
});

test("if the agent said more than the answers support, a correction call is required", () => {
  const over = classify(result({ agent_told_them: "may_qualify_exemption", answers: { snap_tanf: "unknown" }, monthly_hours: -1, income_band: "unknown" }));
  assert.equal(over.outcome, "needs_review");
  assert.equal(over.correctionNeeded, true);
  assert.equal(classify(result({ agent_told_them: "may_meet_requirement", monthly_hours: 20 })).correctionNeeded, true);
  assert.equal(classify(result({ agent_told_them: "may_meet_requirement", monthly_hours: 100 })).correctionNeeded, false);
});

test("low CALL-E confidence never lets a favourable result through, but does not by itself demand a correction", () => {
  const c = classify(result({ answers: { pregnant_postpartum: "yes" }, agent_told_them: "may_qualify_exemption" }), "low");
  assert.equal(c.outcome, "needs_review");
  assert.equal(c.correctionNeeded, false);
  assert.deepEqual(c.exemptions, []);
});

test("cascade: not screened is redialled once, then the letter; declined is followed up until the hard cap", () => {
  assert.equal(nextAction("unreachable", 1).type, "retry");
  assert.equal(nextAction("unreachable", 2).type, "mail");
  assert.equal(nextAction("identity_unconfirmed", 1).type, "retry");
  assert.equal(nextAction("declined", 1).type, "follow-up");
  assert.equal(nextAction("declined", 1).delayMinutes, DEFAULT_POLICY.declinedRetryMinutes);
  assert.equal(nextAction("declined", HARD_CALL_CAP).type, "mail");
  assert.equal(nextAction("unreachable", 1, { ...DEFAULT_POLICY, maxAttempts: 9 }).type, "retry");
  assert.equal(nextAction("unreachable", HARD_CALL_CAP, { ...DEFAULT_POLICY, maxAttempts: 9 }).type, "mail", "the hard cap wins over configuration");
});

test("cascade: outcomes map to the right next step", () => {
  assert.equal(nextAction("likely_exempt", 1).type, "packet");
  assert.equal(nextAction("likely_meets", 1).type, "report-reminder");
  assert.equal(nextAction("at_risk", 1).type, "navigator");
  assert.equal(nextAction("at_risk", 1).highPriority, true);
  assert.equal(nextAction("needs_review", 1).type, "navigator");
  assert.equal(nextAction("opted_out", 1).type, "suppress");
  assert.equal(nextAction("not_attempted", 0).type, "operator-review");
  assert.equal(nextAction("cleared_by_data", 0).type, "none");
});

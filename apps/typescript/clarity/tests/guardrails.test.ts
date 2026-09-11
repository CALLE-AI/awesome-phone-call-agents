import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGuardrails, findSensitive, findVerbatim } from "../lib/guardrails";
import type { ApplicationInput } from "../lib/types";
import demo from "../fixtures/demo-application.json" with { type: "json" };

const app: ApplicationInput = {
  jobDescription: demo.jobDescription,
  resume: demo.resume,
  answers: demo.answers,
  candidateName: demo.candidateName,
  roleTitle: demo.roleTitle,
};

const base = {
  whyItMatters: "The role weights what you personally diagnosed over what the queue resolved.",
  question: "On that incident, what did you diagnose before anyone else was involved?",
  probes: ["Which logs did you open yourself?", "Who found the root cause?"],
  extract: ["personal diagnosis vs. team diagnosis"],
};

test("verbatim claim is anchored to its source", () => {
  const found = findVerbatim("Resolved critical production incidents for enterprise customers", app);
  assert.equal(found?.source, "resume");
  assert.equal(found?.text, "Resolved critical production incidents for enterprise customers");
});

test("whitespace drift still anchors, and returns the original span", () => {
  const found = findVerbatim("Resolved  critical production\n  incidents for enterprise customers", app);
  assert.equal(found?.text, "Resolved critical production incidents for enterprise customers");
});

test("paraphrase is not verbatim", () => {
  assert.equal(findVerbatim("Resolved critical production incident for enterprise customers", app), null);
  assert.equal(findVerbatim("Fixed critical outages for large enterprise accounts", app), null);
});

test("a claim too short to anchor anything is rejected", () => {
  assert.equal(findVerbatim("AWS", app), null);
});

test("protected attributes are caught in questions", () => {
  assert.ok(findSensitive({ ...base, claim: "x", question: "How old are you?" }));
  assert.ok(findSensitive({ ...base, claim: "x", question: "Do you have children at home?" }));
  assert.ok(
    findSensitive({ ...base, claim: "x", question: "ok?", probes: ["Do you need visa sponsorship?"] }),
  );
  assert.ok(findSensitive({ ...base, claim: "x", question: "Are you married?" }));
});

test("protected attributes are caught even when the candidate raised them", () => {
  assert.ok(
    findSensitive({
      ...base,
      claim: "I took maternity leave in 2022",
      question: "Tell me about the 2022 gap.",
    }),
  );
});

test("domain vocabulary in the candidate's own words is not a protected attribute", () => {
  // The candidate worked in health tech; that is not a health disclosure.
  assert.equal(
    findSensitive({
      ...base,
      claim: "Supported the health records workload on AWS",
      question: "What part of that workload did you personally troubleshoot?",
      probes: ["Which components were yours to diagnose?"],
    }),
    null,
  );
  assert.equal(findSensitive({ ...base, claim: "Owned the family of billing services" }), null);
});

test("guardrails keep good items, drop bad ones, and cap at three", () => {
  const outcome = applyGuardrails(
    [
      { ...base, claim: "Resolved critical production incidents for enterprise customers" },
      { ...base, claim: "I was on the case from the start and worked it through to resolution" },
      { ...base, claim: "Maintained 98% CSAT" },
      { ...base, claim: "Handled Sev-1 incidents" },
      { ...base, claim: "Invented a time machine" },
      { ...base, claim: "Supported AWS environments", question: "How old were you then?" },
    ],
    app,
  );

  assert.equal(outcome.kept.length, 3);
  assert.deepEqual(
    outcome.kept.map((c) => c.id),
    ["c1", "c2", "c3"],
  );
  assert.equal(outcome.kept[0]!.source, "resume");
  assert.equal(outcome.kept[1]!.source, "answers");

  const reasons = outcome.rejected.map((r) => r.reason).sort();
  assert.deepEqual(reasons, ["not-verbatim", "over-cap", "sensitive-attribute"]);
});

test("a sensitive item is dropped before it can consume a slot", () => {
  const outcome = applyGuardrails(
    [
      {
        ...base,
        claim: "Resolved critical production incidents for enterprise customers",
        question: "How old are you?",
      },
      { ...base, claim: "I was on the case from the start and worked it through to resolution" },
    ],
    app,
  );
  assert.equal(outcome.kept.length, 1);
  assert.equal(
    outcome.kept[0]!.claim,
    "I was on the case from the start and worked it through to resolution",
  );
});

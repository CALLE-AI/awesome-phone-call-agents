import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkPolicy,
  validateCorpus,
  validatePolicy,
} from "./check-boundary-policy.mjs";

const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL("../references/probes.v1.json", import.meta.url)), "utf8"),
);
const policy = JSON.parse(
  readFileSync(fileURLToPath(new URL("../references/example-policy.json", import.meta.url)), "utf8"),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("bundled corpus and example policy pass all static probes", () => {
  assert.deepEqual(validateCorpus(corpus), []);
  assert.deepEqual(validatePolicy(policy), []);
  const report = checkPolicy(policy, corpus);
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.probe_results.length, 8);
  assert.equal(report.probe_results.every((result) => result.matched), true);
});

test("report refuses every behavior and live-call claim", () => {
  const report = checkPolicy(policy, corpus);
  assert.equal(report.verified_scope, "static-policy-declarations");
  assert.equal(report.text_classification_verified, false);
  assert.equal(report.agent_behavior_verified, false);
  assert.equal(report.model_behavior_verified, false);
  assert.equal(report.provider_behavior_verified, false);
  assert.equal(report.live_call_verified, false);
  assert.deepEqual(report.external_side_effects, []);
});

test("missing category rule fails closed", () => {
  const candidate = clone(policy);
  delete candidate.rules.medical_advice;
  const report = checkPolicy(candidate, corpus);
  assert.equal(report.ok, false);
  assert.match(report.findings.join("\n"), /missing rule for medical_advice/);
});

test("permissive unknown-event default is rejected", () => {
  const candidate = clone(policy);
  candidate.default_rule.may_continue_call = true;
  const report = checkPolicy(candidate, corpus);
  assert.equal(report.ok, false);
  assert.match(report.findings.join("\n"), /default_rule must escalate/);
});

test("wrong-recipient context disclosure is rejected", () => {
  const candidate = clone(policy);
  candidate.rules.wrong_recipient.may_disclose_context = true;
  const report = checkPolicy(candidate, corpus);
  assert.equal(report.ok, false);
  const result = report.probe_results.find((item) => item.probe_id === "wrong-recipient");
  assert.equal(result?.matched, false);
});

test("ambiguous language cannot continue the call", () => {
  const candidate = clone(policy);
  candidate.rules.ambiguous_inference.may_continue_call = true;
  const report = checkPolicy(candidate, corpus);
  assert.equal(report.ok, false);
  const result = report.probe_results.find((item) => item.probe_id === "ambiguous-inference");
  assert.equal(result?.matched, false);
});

test("policy must bind to the exact corpus version", () => {
  const candidate = clone(policy);
  candidate.corpus.version = "2.0";
  assert.match(validatePolicy(candidate).join("\n"), /call-boundary-probes\/1\.0/);
  assert.equal(checkPolicy(candidate, corpus).ok, false);
});

test("unknown fields and categories are rejected", () => {
  const candidate = clone(policy);
  candidate.unchecked_override = true;
  candidate.rules.surprise = clone(candidate.default_rule);
  const errors = validatePolicy(candidate).join("\n");
  assert.match(errors, /unknown field unchecked_override/);
  assert.match(errors, /unknown category surprise/);
});

test("wrong types, null, and arrays fail closed", () => {
  for (const value of [null, [], "policy", 1, true]) {
    assert.notDeepEqual(validatePolicy(value), [], `unexpectedly accepted ${JSON.stringify(value)}`);
  }
  for (const field of ["corpus", "default_rule", "rules"]) {
    for (const value of [null, [], "object"]) {
      const candidate = clone(policy);
      candidate[field] = value;
      assert.notDeepEqual(
        validatePolicy(candidate),
        [],
        `unexpectedly accepted ${field}=${JSON.stringify(value)}`,
      );
    }
  }
});

test("inherited and prototype-named properties cannot satisfy the contract", () => {
  const inheritedRoot = Object.create({ schema_version: "1.0" });
  Object.assign(inheritedRoot, clone(policy));
  delete inheritedRoot.schema_version;
  assert.match(validatePolicy(inheritedRoot).join("\n"), /missing schema_version/);

  const inheritedRules = clone(policy);
  const ownRules = clone(inheritedRules.rules);
  delete ownRules.medical_advice;
  inheritedRules.rules = Object.assign(
    Object.create({ medical_advice: clone(policy.rules.medical_advice) }),
    ownRules,
  );
  const report = checkPolicy(inheritedRules, corpus);
  assert.equal(report.ok, false);
  assert.match(report.findings.join("\n"), /missing rule for medical_advice/);

  const prototypeNamed = clone(policy);
  Object.defineProperty(prototypeNamed.rules, "__proto__", {
    value: clone(policy.default_rule),
    enumerable: true,
  });
  assert.match(validatePolicy(prototypeNamed).join("\n"), /unknown category __proto__/);
});

test("corpus version cannot retain its identity while weakening expectations", () => {
  const candidateCorpus = clone(corpus);
  candidateCorpus.probes[0].expected.may_continue_call = true;
  candidateCorpus.probes[1].expected.disposition = "escalate";
  const errors = validateCorpus(candidateCorpus).join("\n");
  assert.match(errors, /may_continue_call must be false for corpus v1/);
  assert.match(errors, /disposition weakens the fixed corpus v1 expectation/);
  assert.equal(checkPolicy(policy, candidateCorpus).ok, false);
});

test("alternate corpus content cannot retain the v1 identity", () => {
  const changedText = clone(corpus);
  changedText.probes[0].input = "A different synthetic input with the same declared category.";
  assert.match(validateCorpus(changedText).join("\n"), /immutable corpus v1 probe declaration/);

  const extraProbe = clone(corpus);
  extraProbe.probes.push(clone(extraProbe.probes[0]));
  assert.match(validateCorpus(extraProbe).join("\n"), /exactly 8 corpus v1 probes/);

  const changedDescription = clone(corpus);
  changedDescription.description = "A replacement corpus with enough descriptive text.";
  assert.match(validateCorpus(changedDescription).join("\n"), /immutable corpus v1 description/);
});

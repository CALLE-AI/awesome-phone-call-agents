/**
 * Tests for the recipe's classifier. Run from the plugin directory:
 *
 *   node --test examples/classify.test.mjs
 *
 * Why these exist. A no-code recipe is normally shipped as a JSON file nobody can run
 * until they have imported it, which means its logic is asserted rather than shown. The
 * one piece of real logic here is pulled out into a plain module so it can be executed
 * on any machine with node and no n8n, no API key and no phone call.
 *
 * The last test is the one that keeps this honest: it checks that the code actually
 * embedded in the workflow is the code these tests just exercised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SAFEGUARDING_CALLBACK_MINUTES,
  classifyRecipient,
  maskNumber,
  safeguardingEscalation,
  summariseWave,
} from "./classify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// The default is a call where the parent confirmed they already knew. Before the
// safeguarding rule existed this field was absent and the fixture still read as an ordinary
// closed call. It cannot any more: the rule fails closed, so an absent field escalates, and
// leaving the fixture alone would have meant weakening the rule to keep an old test green.
function recipient(overrides = {}) {
  return {
    status: "completed",
    attempts: [{ provider_call_id: "pc_1" }],
    structured_result: {
      parent_confirmed_aware: "yes",
      reason_category: "illness",
      expected_return: "tomorrow",
    },
    ...overrides,
  };
}

test("an answer with real values resolves the record", () => {
  const out = classifyRecipient(recipient());
  assert.equal(out.resolution, "resolved");
  assert.equal(out.needsAHuman, false);
});

test("a completed call with no structured result is undetermined, not resolved", () => {
  const out = classifyRecipient(recipient({ structured_result: null }));
  assert.equal(out.resolution, "undetermined");
  assert.equal(out.needsAHuman, true);
  assert.match(out.reason, /no structured result/);
});

test("a row of unknowns is not an answer", () => {
  const out = classifyRecipient(recipient({
    structured_result: { reason_category: "unknown", expected_return: "unknown" },
  }));
  assert.equal(out.resolution, "undetermined");
  assert.equal(out.needsAHuman, true);
});

test("unknown is matched after trimming and lowercasing", () => {
  const out = classifyRecipient(recipient({
    structured_result: { reason_category: " Unknown ", expected_return: "UNKNOWN" },
  }));
  assert.equal(out.resolution, "undetermined");
});

test("one unknown field among answered ones still resolves", () => {
  // `all`, not `any`. Flagging any unknown would send answered cases back to a person.
  const out = classifyRecipient(recipient({
    structured_result: { reason_category: "illness", expected_return: "unknown" },
  }));
  assert.equal(out.resolution, "resolved");
});

test("an optional field left unknown is irrelevant", () => {
  const out = classifyRecipient(recipient({
    structured_result: {
      reason_category: "transport",
      expected_return: "today",
      parent_confirmed_aware: "unknown",
    },
  }));
  assert.equal(out.resolution, "resolved");
});

test("a call that reached nobody is failed and names how many numbers were tried", () => {
  const out = classifyRecipient(recipient({
    status: "no_answer",
    attempts: [{ provider_call_id: "pc_1" }, { provider_call_id: "pc_2" }],
    structured_result: null,
  }));
  assert.equal(out.resolution, "failed");
  assert.equal(out.attempts, 2);
  assert.match(out.reason, /2 number\(s\)/);
});

const TASK_RESULT = { reason_category: "illness", expected_return: "today",
                      parent_confirmed_aware: "yes" };

test("a task-level result is read when the call had exactly one recipient", () => {
  // Observed in production: the per-recipient field null and the task-level field fully
  // populated. Reading only the recipient routes a finished conversation to a person,
  // which is a false negative that looks exactly like a real failure.
  const only = { status: "completed", attempts: [{ provider_call_id: "pc_1" }],
                 structured_result: null };
  const call = { recipients: [only], structured_result: TASK_RESULT };
  assert.equal(classifyRecipient(only, call).resolution, "resolved");
  assert.equal(classifyRecipient(only, call).needsAHuman, false);
});

test("a task-level result is never borrowed on a fan-out", () => {
  // Here the result belongs to no particular person, so borrowing it files one family's
  // answer against another family's child. Refused even though it would raise the
  // resolution rate.
  const first = { status: "completed", attempts: [{ provider_call_id: "pc_1" }],
                  structured_result: null };
  const second = { status: "completed", attempts: [{ provider_call_id: "pc_2" }],
                   structured_result: null };
  const call = { recipients: [first, second], structured_result: TASK_RESULT };
  assert.equal(classifyRecipient(first, call).resolution, "undetermined");
  assert.equal(classifyRecipient(second, call).resolution, "undetermined");
});

test("a recipient with its own result never reads the task-level one", () => {
  const own = { reason_category: "transport", expected_return: "tomorrow",
                parent_confirmed_aware: "yes" };
  const only = { status: "completed", attempts: [{ provider_call_id: "pc_1" }],
                 structured_result: own };
  const call = { recipients: [only], structured_result: TASK_RESULT };
  assert.deepEqual(classifyRecipient(only, call).resolution, "resolved");
});

test("classifying without the call still works and reads the recipient alone", () => {
  const only = { status: "completed", attempts: [{ provider_call_id: "pc_1" }],
                 structured_result: null };
  assert.equal(classifyRecipient(only).resolution, "undetermined");
});

test("the provider id comes from the last attempt, not the first", () => {
  const out = classifyRecipient(recipient({
    attempts: [{ provider_call_id: "did_not_connect" }, { provider_call_id: "connected" }],
  }));
  assert.equal(out.providerCallId, "connected");
});

test("a malformed recipient fails closed rather than resolving", () => {
  for (const bad of [null, undefined, "completed", 7, []]) {
    const out = classifyRecipient(bad);
    assert.equal(out.resolution, "failed", `expected failed for ${JSON.stringify(bad)}`);
  }
});

test("numbers are masked before they reach an execution log", () => {
  assert.equal(maskNumber("+915550000001"), "+91*******001");
  assert.equal(maskNumber("abc"), "****");
  assert.equal(maskNumber(null), "****");
  assert.ok(!maskNumber("+915550000001").includes("55500"));
});

test("the wave summary keeps skipped rows out of the attempted count", () => {
  const summary = summariseWave([
    { id: "S-1", resolution: "resolved", attempts: 1 },
    { id: "S-2", resolution: "resolved", attempts: 1 },
    { id: "S-3", resolution: "resolved", attempts: 2 },
    { id: "S-4", resolution: "undetermined", attempts: 1, needsAHuman: true, reason: "null result" },
    { id: "S-5", resolution: "skipped", attempts: 0 },
    { id: "S-6", resolution: "failed", attempts: 2, needsAHuman: true, reason: "nobody answered" },
  ]);
  assert.equal(summary.attempted, 5, "skipped is never attempted");
  assert.equal(summary.counts.skipped, 1);
  assert.equal(summary.attemptsBilled, 7);
  assert.equal(summary.attemptsResolved, 4);
  assert.equal(summary.attemptsOpen, 3);
  assert.equal(summary.attemptsResolved + summary.attemptsOpen, summary.attemptsBilled);
  assert.equal(summary.counts.resolved / summary.attempted, summary.resolutionRate);
  assert.deepEqual(summary.queue.map((q) => q.id), ["S-4", "S-6"]);
});

test("an empty wave reports no rate rather than a rate of zero", () => {
  // Nothing attempted is not the same as nothing resolved.
  assert.equal(summariseWave([]).resolutionRate, null);
  assert.equal(summariseWave(null).resolutionRate, null);
});

test("the workflow embeds exactly the code these tests just ran", async () => {
  // Without this, the tested module and the shipped workflow are two separate things
  // that merely started out the same.
  const source = await readFile(join(HERE, "classify.mjs"), "utf8");
  const workflow = JSON.parse(
    await readFile(join(HERE, "absence-wave.workflow.json"), "utf8"),
  );
  const node = workflow.nodes.find((n) => n.name === "Classify Outcome");
  assert.ok(node, "the workflow has no Classify Outcome node");

  // n8n code nodes are not ES modules, so `export ` is stripped when the file is inlined.
  const inlined = source.replace(/^export /gm, "").trimEnd();
  assert.ok(
    node.parameters.jsCode.includes(inlined),
    "the Classify Outcome node no longer contains the contents of classify.mjs. "
      + "Regenerate it with: node examples/build-workflow.mjs",
  );
});
test("a parent who did not know is escalated, and is still resolved", () => {
  const out = classifyRecipient(recipient({
    structured_result: {
      parent_confirmed_aware: "no",
      reason_category: "illness",
      expected_return: "tomorrow",
    },
  }));
  // The answer arrived and it was schema-valid, so the resolution does not change. What
  // changes is that nobody may close it without a person looking at it.
  assert.equal(out.resolution, "resolved");
  assert.equal(out.escalation, "safeguarding");
  assert.equal(out.needsAHuman, true);
  assert.match(out.reason, /safeguarding/);
});

test("escalation is a second axis and never a fourth resolution", () => {
  // If this ever becomes a fourth value, every count in summariseWave is wrong: a call would
  // be in two buckets or in none, and the three outcomes exist to be counted.
  const escalated = classifyRecipient(recipient({
    structured_result: { parent_confirmed_aware: "no", reason_category: "illness" },
  }));
  assert.ok(["resolved", "undetermined", "failed"].includes(escalated.resolution));
  assert.notEqual(escalated.resolution, "safeguarding");
});

test("the rule fails closed on anything that is not an explicit yes", () => {
  for (const value of [undefined, null, "", "no", "unknown", "YES?", "y", 0, "maybe"]) {
    assert.equal(
      safeguardingEscalation({ parent_confirmed_aware: value, expected_return: "tomorrow", reason_category: "illness" }),
      "safeguarding",
      `${JSON.stringify(value)} should not close a call`,
    );
  }
  for (const value of ["yes", "YES", " Yes "]) {
    assert.equal(
      safeguardingEscalation({ parent_confirmed_aware: value, expected_return: "tomorrow", reason_category: "illness" }),
      "none",
      `${JSON.stringify(value)} is a confirmation`,
    );
  }
  assert.equal(safeguardingEscalation(null), "safeguarding");
  assert.equal(safeguardingEscalation("not an object"), "safeguarding");
});

test("an escalated call is not counted as closed", () => {
  const summary = summariseWave([
    { id: "A", resolution: "resolved", escalation: "none", attempts: 1, needsAHuman: false },
    { id: "B", resolution: "resolved", escalation: "safeguarding", attempts: 3, needsAHuman: true },
  ]);
  assert.equal(summary.counts.resolved, 2);
  assert.equal(summary.escalated, 1);
  assert.equal(summary.closed, 1);
  // Two resolved out of two attempted would read as 100%. One of them is not finished with.
  assert.equal(summary.resolutionRate, 0.5);
  // B's three attempts are still somebody's work, so they are not counted as saved.
  assert.equal(summary.attemptsResolved, 1);
  assert.equal(summary.attemptsOpen, 3);
  assert.equal(summary.safeguardingCallbackMinutes, SAFEGUARDING_CALLBACK_MINUTES);
});

test("safeguarding rows sort to the top of the human queue", () => {
  const summary = summariseWave([
    { id: "A", resolution: "failed", escalation: "none", attempts: 2, needsAHuman: true },
    { id: "B", resolution: "undetermined", escalation: "none", attempts: 1, needsAHuman: true },
    { id: "C", resolution: "resolved", escalation: "safeguarding", attempts: 1, needsAHuman: true },
  ]);
  assert.equal(summary.queue.length, 3);
  assert.equal(summary.queue[0].id, "C", "the safeguarding case must be worked first");
  assert.equal(summary.queue[0].escalation, "safeguarding");
});


test("an all-unknown answer is flagged, not filed as an ordinary callback", () => {
  // This is the branch the two shipped classifiers disagreed on. Nobody confirmed they
  // knew the child was absent, because nobody said anything usable at all.
  const out = classifyRecipient(recipient({
    structured_result: { reason_category: "unknown", expected_return: "unknown" },
  }));
  assert.equal(out.resolution, "undetermined");
  assert.equal(out.escalation, "safeguarding",
    "an answer that learned nothing cannot also be an answer that reassured anyone");
  assert.equal(out.needsAHuman, true);
});

test("a confirmed parent who then gave no return date escalates under the 3-field rule", () => {
  // S-3127 reproduction: A parent may confirm awareness, but an unknown return date for
  // an unexplained absence is a potential missing-child risk that cannot safely close.
  const out = classifyRecipient(recipient({
    structured_result: {
      parent_confirmed_aware: "yes",
      reason_category: "unknown",
      expected_return: "unknown",
    },
  }));
  assert.equal(out.resolution, "undetermined");
  assert.equal(out.escalation, "safeguarding");
  assert.equal(out.needsAHuman, true);
});

test("a value outside the enum is undetermined here, as it is in the python surface", () => {
  const out = classifyRecipient(recipient({
    structured_result: { reason_category: "CATASTROPHIC", expected_return: "tomorrow" },
  }));
  assert.equal(out.resolution, "undetermined",
    "a result this recipe cannot vouch for must not close a record");
  assert.match(out.reason, /did not satisfy the schema/);
  assert.equal(out.escalation, "safeguarding");
});

test("a required field that is absent or null does not close a record", () => {
  for (const result of [
    { reason_category: "illness" },
    { reason_category: "illness", expected_return: null },
  ]) {
    const out = classifyRecipient(recipient({ structured_result: result }));
    assert.equal(out.resolution, "undetermined", JSON.stringify(result));
  }
});

test("an escalated undetermined row cannot push closed below zero", () => {
  // Before the count was split, every safeguarding row was subtracted from `resolved`.
  // One undetermined escalation and no resolved rows gave closed = -1 and a negative
  // resolution rate: a wave of calls reported as having un-closed cases.
  const summary = summariseWave([
    { id: "A", resolution: "undetermined", escalation: "safeguarding", attempts: 2, needsAHuman: true },
  ]);
  assert.equal(summary.closed, 0);
  assert.equal(summary.escalated, 0, "it was never resolved, so it was never closed");
  assert.equal(summary.escalatedUnresolved, 1, "and it still has to be reported");
  assert.equal(summary.resolutionRate, 0);
  assert.ok(summary.resolutionRate >= 0);
});

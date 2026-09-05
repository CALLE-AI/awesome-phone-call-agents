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

import { classifyRecipient, maskNumber, summariseWave } from "./classify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function recipient(overrides = {}) {
  return {
    status: "completed",
    attempts: [{ provider_call_id: "pc_1" }],
    structured_result: { reason_category: "illness", expected_return: "tomorrow" },
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

test("a task-level result is never borrowed for a recipient that has none", () => {
  // On a fan-out call this fallback files one family's answer against another family's
  // child. It is refused even though it would raise the resolution rate.
  const withTaskResult = {
    status: "completed",
    attempts: [{ provider_call_id: "pc_1" }],
    structured_result: null,
    task: { structured_result: { reason_category: "illness", expected_return: "today" } },
  };
  assert.equal(classifyRecipient(withTaskResult).resolution, "undetermined");
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

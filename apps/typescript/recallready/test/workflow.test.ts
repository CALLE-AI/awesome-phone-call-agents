import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FileCallCheckpointStore } from "../src/checkpoints.js";
import { MockCallProvider } from "../src/providers.js";
import type { CallProvider } from "../src/providers.js";
import { RecallWorkflow } from "../src/workflow.js";
import { recallFixture } from "./fixtures.js";

test("official preview masks the published number and exposes boundaries", () => {
  const workflow = new RecallWorkflow();
  const preview = workflow.createPreview(recallFixture, { recallId: recallFixture.id, modelNumber: "MODEL-A" }, false);
  assert.equal(preview.maskedPhone, "••• ••• 0108");
  assert.equal(preview.phoneSource, "official_recall_record");
  assert.ok(preview.boundaries.some((boundary) => boundary.includes("No name")));
});

test("authorized demo route requires explicit permission", () => {
  const workflow = new RecallWorkflow();
  assert.throws(() => workflow.createPreview(recallFixture, {
    recallId: recallFixture.id,
    modelNumber: "MODEL-A",
    demoPhone: "+18335550109",
    demoConsent: false,
  }, true), /explicit ownership or permission/);
});

test("preview requires an exact model identifier", () => {
  const workflow = new RecallWorkflow();
  assert.throws(() => workflow.createPreview(recallFixture, {
    recallId: recallFixture.id,
    modelNumber: " ",
  }, false), /model number/);
});

test("exact approval runs once and returns a structured result", async () => {
  const workflow = new RecallWorkflow();
  const preview = workflow.createPreview(recallFixture, {
    recallId: recallFixture.id,
    modelNumber: "MODEL-A",
  }, false);
  await assert.rejects(() => workflow.execute(preview.previewId, "yes", new MockCallProvider()), /CALL NOW/);
  const result = await workflow.execute(preview.previewId, "CALL NOW", new MockCallProvider());
  assert.equal(result.eligibility, "confirmed");
  assert.equal(result.provider, "mock");
  await assert.rejects(() => workflow.execute(preview.previewId, "CALL NOW", new MockCallProvider()), /already been used/);
});

test("durable checkpoint blocks a redial after an ambiguous restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recallready-checkpoint-"));
  const path = join(directory, "calls.json");
  let firstCalls = 0;
  let secondCalls = 0;
  const ambiguousProvider: CallProvider = {
    async run() { firstCalls += 1; throw new Error("Synthetic timeout after create"); },
  };
  const shouldNotRun: CallProvider = {
    async run() { secondCalls += 1; return new MockCallProvider().run("", "", "unexpected"); },
  };
  try {
    const firstWorkflow = new RecallWorkflow(new FileCallCheckpointStore(path));
    const firstPreview = firstWorkflow.createPreview(recallFixture, {
      recallId: recallFixture.id, modelNumber: "MODEL-A",
    }, true);
    await assert.rejects(() => firstWorkflow.execute(firstPreview.previewId, "CALL NOW", ambiguousProvider), /Synthetic timeout/);
    const restartedWorkflow = new RecallWorkflow(new FileCallCheckpointStore(path));
    const secondPreview = restartedWorkflow.createPreview(recallFixture, {
      recallId: recallFixture.id, modelNumber: "MODEL-A",
    }, true);
    await assert.rejects(() => restartedWorkflow.execute(secondPreview.previewId, "CALL NOW", shouldNotRun), /durable checkpoint/);
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

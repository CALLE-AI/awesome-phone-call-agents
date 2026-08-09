import assert from "node:assert/strict";
import { test } from "node:test";
import { MockCallProvider } from "../src/providers.js";
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

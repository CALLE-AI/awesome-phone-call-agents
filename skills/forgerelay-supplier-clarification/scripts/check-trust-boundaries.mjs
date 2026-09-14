#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const validator = resolve(
  "skills/forgerelay-supplier-clarification/scripts/validate-clarification-input.mjs",
);
const fixture = JSON.parse(
  await readFile(
    "skills/forgerelay-supplier-clarification/assets/example-request.json",
    "utf8",
  ),
);
const { safetyReview: _fixtureSafetyReview, ...unreviewedFixture } = fixture;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "forgerelay-trust-"));

const run = async (name, value) => {
  const path = join(temporaryDirectory, `${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  const result = spawnSync(process.execPath, [validator, path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const raw = result.stdout.trim() || result.stderr.trim();
  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    throw new Error(`${name}: validator did not return JSON: ${raw}`);
  }
  return { code: result.status, output };
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  const nullInput = await run("null-input", null);
  assert(nullInput.code === 1, "JSON null must be blocked without crashing");
  assert(nullInput.output.status === "blocked", "JSON null status must be blocked");

  const publicWebsite = await run("public-website", {
    ...fixture,
    outreachBasis: "Phone number found on the supplier public website.",
  });
  assert(publicWebsite.code === 1, "public-website-only outreach must be blocked");

  const proseTarget = await run("prose-target", {
    ...fixture,
    resultTarget: "ForgeRelay clarification record",
  });
  assert(proseTarget.code === 1, "a prose result target must be blocked");

  const commercialCommitment = await run("commercial-commitment", {
    ...fixture,
    questions: [
      {
        id: "fixed-price",
        category: "quote-statement",
        prompt: "Can you agree to a fixed price and guarantee delivery next Friday?",
        required: true,
      },
    ],
  });
  assert(commercialCommitment.code === 1, "commercial commitments must be blocked");

  const pending = await run("pending", unreviewedFixture);
  assert(pending.code === 3, "unreviewed free text must require safety review");
  assert(
    pending.output.status === "pending-safety-review",
    "unreviewed free text must not report dry-run ready",
  );

  const approvedInput = {
    ...unreviewedFixture,
    safetyReview: {
      status: "approved",
      reviewedBy: "fixture-reviewer",
      contentHash: pending.output.safetyReviewHash,
    },
  };
  const approved = await run("approved", approvedInput);
  assert(approved.code === 0, "matching content-bound review must pass");
  assert(approved.output.status === "dry-run", "approved fixture must be dry-run ready");

  const changed = await run("changed-after-review", {
    ...approvedInput,
    questions: approvedInput.questions.map((question, index) =>
      index === 0
        ? { ...question, prompt: `${question.prompt} Please repeat the answer.` }
        : question,
    ),
  });
  assert(changed.code === 3, "editing a prompt must invalidate the review");
  assert(
    changed.output.safetyReviewHash !== pending.output.safetyReviewHash,
    "editing a prompt must change the safety review hash",
  );
  assert(
    changed.output.idempotencyKey !== pending.output.idempotencyKey,
    "editing a prompt must change the idempotency key",
  );

  console.log("Trust-boundary checks passed (7 cases).");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

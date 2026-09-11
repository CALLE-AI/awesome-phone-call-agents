import assert from "node:assert/strict";
import test from "node:test";
import { compileCallback, type CallbackInput } from "../src/core.js";

function fixture(): CallbackInput {
  return {
    business_name: "Example Repair",
    recipient: { phone: "+12025550147", region: "US", locale: "en-US" },
    objective: "Ask which service window is preferred.",
    consent: { affirmed: true, method: "web_form", recorded_at: "2026-08-07T12:00:00.000Z" },
    facts: [{
      kind: "hours",
      value: "Weekdays 8 to 6",
      source_url: "https://example.com/hours",
      source_quote: "Weekdays 8 to 6",
      source_sha256: "a".repeat(64),
      approved: true
    }]
  };
}

test("compiles approved evidence into a deterministic masked preview", () => {
  const first = compileCallback(fixture(), new Date("2026-08-08T13:00:00.000Z"));
  const second = compileCallback(fixture(), new Date("2026-08-08T13:00:00.000Z"));
  assert.equal(first.workflow_hash, second.workflow_hash);
  assert.equal(first.masked_phone, "+1******0147");
  assert.equal(first.approval_phrase, "APPROVE CALL 0147");
  assert.match(first.call_task, /source: https:\/\/example\.com\/hours/);
});

test("refuses missing consent", () => {
  const input = fixture();
  input.consent.affirmed = false;
  assert.throws(() => compileCallback(input), /Positive callback consent/);
});

test("refuses an approved fact without source custody", () => {
  const input = fixture();
  input.facts[0].source_sha256 = "unknown";
  assert.throws(() => compileCallback(input), /SHA-256 source hash/);
});

test("excludes unapproved claims from the task", () => {
  const input = fixture();
  input.facts.push({
    kind: "price",
    value: "$1",
    source_url: "https://example.com/price",
    source_quote: "$1",
    source_sha256: "b".repeat(64),
    approved: false
  });
  assert.doesNotMatch(compileCallback(input).call_task, /\$1/);
});

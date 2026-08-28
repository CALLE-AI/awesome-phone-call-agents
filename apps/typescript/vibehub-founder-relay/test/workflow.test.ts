import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTask,
  buildRequestFingerprint,
  isSupportedRegion,
  isValidPhone,
  maskPhone,
  normalizePhone,
  parseFounderRelayResult,
  resolveCalleBaseUrl,
  safeFailureCode,
  verifiedFounderRelayResult,
} from "../src/workflow.js";

test("normalizes and masks phone numbers", () => {
  const phone = normalizePhone("+60 10-000 0000");
  assert.equal(phone, "+60100000000");
  assert.equal(maskPhone(phone), "+601******000");
});

test("validates region-specific E.164 shapes", () => {
  assert.equal(isSupportedRegion("MY"), true);
  assert.equal(isSupportedRegion("TW"), false);
  assert.equal(isValidPhone("+60100000000", "MY"), true);
  assert.equal(isValidPhone("+6512345678", "MY"), false);
});

test("task discloses automation and limits sensitive collection", () => {
  const task = buildTask("Example Founder", "Test a product sprint");
  assert.match(task, /automated AI call from VibeHub/i);
  assert.match(task, /under one minute/i);
  assert.match(task, /sensitive information/i);
});

test("restricts API credentials to the official origin or exact loopback test origins", () => {
  assert.equal(resolveCalleBaseUrl(undefined), "https://api.heycall-e.com");
  assert.equal(resolveCalleBaseUrl("https://api.heycall-e.com/"), "https://api.heycall-e.com");
  assert.equal(resolveCalleBaseUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(resolveCalleBaseUrl("http://[::1]:8787"), "http://[::1]:8787");
  assert.throws(() => resolveCalleBaseUrl("https://evil.example"));
  assert.throws(() => resolveCalleBaseUrl("https://api.heycall-e.com.evil.example"));
  assert.throws(() => resolveCalleBaseUrl("https://api.heycall-e.com/v1"));
  assert.throws(() => resolveCalleBaseUrl("http://localhost:8787"));
});

test("binds idempotency to all call-defining context", () => {
  const base = {
    runId: "relay-example-001",
    phone: "+60100000000",
    region: "MY" as const,
    candidate: "Example Founder",
    goal: "Test a product sprint",
    task: buildTask("Example Founder", "Test a product sprint"),
  };
  const fingerprint = buildRequestFingerprint(base);
  assert.notEqual(buildRequestFingerprint({ ...base, candidate: "Another Founder" }), fingerprint);
  assert.notEqual(buildRequestFingerprint({ ...base, goal: "Test a growth sprint" }), fingerprint);
  assert.notEqual(buildRequestFingerprint({ ...base, task: `${base.task}\nChanged.` }), fingerprint);
});

test("accepts only successful, confident, schema-valid structured results", () => {
  const structuredResult = {
    available_now: "yes",
    interest: "yes",
    focus: "engineering",
    start_window: "this_week",
    echoed_phone: "+60******000",
  };
  assert.deepEqual(parseFounderRelayResult(structuredResult), {
    available_now: "yes",
    interest: "yes",
    focus: "engineering",
    start_window: "this_week",
  });
  assert.deepEqual(verifiedFounderRelayResult({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.9, label: "high" },
    recipientStatus: "completed",
    structuredResult,
  }), {
    available_now: "yes",
    interest: "yes",
    focus: "engineering",
    start_window: "this_week",
  });
  assert.equal(verifiedFounderRelayResult({
    status: "failed",
    taskCompleted: false,
    completionConfidence: null,
    recipientStatus: "failed",
    structuredResult,
  }), null);
  assert.equal(verifiedFounderRelayResult({
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.2, label: "low" },
    recipientStatus: "completed",
    structuredResult,
  }), null);
  assert.equal(parseFounderRelayResult({ ...structuredResult, focus: "call +60******000" }), null);
  assert.equal(safeFailureCode("provider_timeout"), "provider_timeout");
  assert.equal(safeFailureCode("failed for +60******000"), null);
});

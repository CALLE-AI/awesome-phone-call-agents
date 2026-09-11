import assert from "node:assert/strict";
import test from "node:test";

import {
  maskPhoneForDisplay,
  publicProviderFailureMessage,
  redactSensitiveText,
  sanitizeResultData,
  sanitizeFailureCode,
  sanitizeTranscript,
} from "../lib/privacy/redaction";

test("masks phone numbers, email addresses, bearer values, and URL credentials in text", () => {
  const value =
    "Call +1 (415) 555-0100, email lead@example.com, Bearer abc.def, " +
    "or connect amqps://user:password@broker.example/vhost";
  const sanitized = redactSensitiveText(value);

  assert.equal(sanitized.includes("415"), false);
  assert.equal(sanitized.includes("lead@example.com"), false);
  assert.equal(sanitized.includes("abc.def"), false);
  assert.equal(sanitized.includes("user:password"), false);
  assert.match(sanitized, /0100/);
  assert.equal(redactSensitiveText("api_key=sk_live_1234567890123456").includes("123456"), false);
  assert.equal(redactSensitiveText("Meeting date 2026-09-09"), "Meeting date 2026-09-09");
});

test("deeply sanitizes nested structured results and transcript-like arrays", () => {
  const sanitized = sanitizeResultData({
    qualified: true,
    contact: { phoneNumber: "+14155550100", email: "lead@example.com" },
    transcript_turns: [
      { speaker: "user", text: "Reach me at +44 20 7946 0958" },
      { speaker: "agent", authorization: "Bearer live-secret" },
    ],
  });

  assert.equal(sanitized?.qualified, true);
  assert.equal(JSON.stringify(sanitized).includes("+14155550100"), false);
  assert.equal(JSON.stringify(sanitized).includes("lead@example.com"), false);
  assert.equal(JSON.stringify(sanitized).includes("live-secret"), false);
  assert.match(JSON.stringify(sanitized), /0958/);
});

test("sanitizes an approved request snapshot before result-row persistence", () => {
  const sanitized = sanitizeResultData({
    phone: "+14155550100",
    task: "If needed, call back on +14155550101.",
    resultSchema: { type: "object" },
  });

  assert.equal(sanitized?.phone, "[PHONE ••••0100]");
  assert.equal(String(sanitized?.task).includes("+14155550101"), false);
});

test("sanitizes transcript text and exposes only a generic provider failure", () => {
  assert.equal(
    sanitizeTranscript("User: my number is +14155550107"),
    "User: my number is [PHONE ••••0107]",
  );
  assert.equal(publicProviderFailureMessage().includes("+"), false);
  assert.equal(maskPhoneForDisplay("+14155550100"), "[PHONE ••••0100]");
  assert.equal(sanitizeFailureCode("declined.+14155550100"), "provider_failure");
});

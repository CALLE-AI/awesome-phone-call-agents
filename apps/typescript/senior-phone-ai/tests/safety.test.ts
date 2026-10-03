import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryActionAuthorizationStore,
  type ActionRequest,
} from "../lib/safety/authorization";
import {
  assertStrictE164,
  maskPhoneNumber,
  redactPhoneNumbers,
  toE164FromNationalNumber,
} from "../lib/safety/phone";
import { assessConversationBoundary, mayRunAutomatically } from "../lib/safety/policy";
import { callFailureCode, createCallLogEntry } from "../lib/observability/call-log";

const request: ActionRequest = {
  principalId: "synthetic-senior",
  seniorId: "20000000-0000-4000-8000-000000000001",
  action: "send_sms",
  destinationE164: "+12025550123",
  purpose: "Send the requested event details",
  details: { message: "Synthetic event details", source: "https://example.com/event" },
};

function createStore(clock: { now: number }) {
  return new InMemoryActionAuthorizationStore({
    now: () => clock.now,
    createId: () => "authorization-1",
    ttlMs: 1_000,
  });
}

test("strict E.164 validation rejects conversational and non-ASCII forms", () => {
  assert.equal(assertStrictE164(request.destinationE164), request.destinationE164);
  for (const invalid of [
    "2025550123",
    "+1 202 555 0123",
    "+12025550123 ",
    "+0123456789",
    "+１２０２５５５０１２３",
    "+1234567890123456",
  ]) {
    assert.throws(() => assertStrictE164(invalid));
  }
});

test("national phone input is normalized to E.164", () => {
  assert.equal(toE164FromNationalNumber("+61", "0449 852 021", true), "+61449852021");
  assert.equal(toE164FromNationalNumber("+61", "+61 (0) 449 852 021", true), "+61449852021");
  assert.equal(toE164FromNationalNumber("+61", "0061 449 852 021", true), "+61449852021");
  assert.equal(toE164FromNationalNumber("+61", "0011 61 449 852 021", true), "+61449852021");
  assert.equal(toE164FromNationalNumber("+61", "61-449-852-021", true), "+61449852021");
  assert.equal(toE164FromNationalNumber("+1", "(202) 555-0123"), "+12025550123");
  assert.throws(() => toE164FromNationalNumber("61", "0449852021", true));
  assert.throws(() => toE164FromNationalNumber("+61", "+44 20 7946 0958", true));
  assert.throws(() => toE164FromNationalNumber("+61", "0449 852 021 ext 2", true));
});

test("phone summaries and nested log text reveal only the last four digits", () => {
  assert.equal(maskPhoneNumber(request.destinationE164), "[phone ending 0123]");
  assert.equal(
    redactPhoneNumbers("Call +1 (202) 555-0123 or 020 7946 0958."),
    "Call [phone ending 0123] or [phone ending 0958].",
  );
});

test("call scheduler logs mask destinations and hash schedule identifiers", () => {
  const entry = createCallLogEntry({
    destinationE164: request.destinationE164,
    durationMs: 123,
    event: "provider_request_failed",
    providerCode: "http_503 response details are excluded",
    requestId: "private-idempotency-key",
    scheduledFor: "2026-09-11T08:00:00.000Z",
    source: "provider",
  }, "2026-09-11T08:00:01.000Z");
  const serialized = JSON.stringify(entry);
  assert.equal(entry.destination, "[phone ending 0123]");
  assert.equal(entry.providerCode, "http_503_response_details_are_excluded");
  assert.equal(entry.requestReference.length, 12);
  assert.doesNotMatch(serialized, /12025550123|private-idempotency-key/);
  assert.equal(callFailureCode(new Error("CALL-E create status 503")), "http_503");
  assert.equal(callFailureCode(Object.assign(new Error("CALL-E create status 422"), { providerCode: "invalid_phone" })), "invalid_phone");
  assert.equal(callFailureCode(new Error("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })), "und_err_connect_timeout");
});

test("read-only tools may run automatically while side effects may not", () => {
  assert.equal(mayRunAutomatically("search_web"), true);
  assert.equal(mayRunAutomatically("send_sms"), false);
  assert.equal(mayRunAutomatically("create_reminder"), false);
  assert.equal(mayRunAutomatically("contact_trusted_person"), false);
  assert.equal(mayRunAutomatically("place_outbound_call"), false);
});

test("an exact confirmed action is authorized once", () => {
  const clock = { now: 1_000 };
  const store = createStore(clock);
  const pending = store.propose(request);

  assert.equal(pending.destinationSummary, "[phone ending 0123]");
  assert.deepEqual(store.consume(pending.authorizationId, request), {
    allowed: false,
    reason: "denied",
  });
  assert.deepEqual(store.confirm(pending.authorizationId, request.principalId, true), {
    allowed: true,
  });
  assert.deepEqual(store.consume(pending.authorizationId, request), { allowed: true });
  assert.deepEqual(store.consume(pending.authorizationId, request), {
    allowed: false,
    reason: "already-used",
  });
});

test("confirmation projections redact purpose numbers and reject credential fields", () => {
  const clock = { now: 1_000 };
  const store = createStore(clock);
  const pending = store.propose({
    ...request,
    purpose: "Send details to +1 (202) 555-0123",
  });
  assert.equal(pending.purposeSummary, "Send details to [phone ending 0123]");
  assert.throws(() => store.propose({
    ...request,
    details: { apiKey: "must-not-enter-authorization-state" },
  }));
});

test("denied, expired, wrong-principal and changed action parameters fail closed", () => {
  const clock = { now: 1_000 };
  const deniedStore = createStore(clock);
  const denied = deniedStore.propose(request);
  assert.deepEqual(deniedStore.confirm(denied.authorizationId, request.principalId, false), {
    allowed: false,
    reason: "denied",
  });

  const mismatchedStore = createStore(clock);
  const mismatched = mismatchedStore.propose(request);
  assert.deepEqual(mismatchedStore.confirm(mismatched.authorizationId, "different-user", true), {
    allowed: false,
    reason: "denied",
  });
  assert.deepEqual(mismatchedStore.confirm(mismatched.authorizationId, request.principalId, true), {
    allowed: true,
  });
  assert.deepEqual(
    mismatchedStore.consume(mismatched.authorizationId, {
      ...request,
      destinationE164: "+12025550124",
    }),
    { allowed: false, reason: "mismatched" },
  );
  assert.deepEqual(
    mismatchedStore.consume(mismatched.authorizationId, {
      ...request,
      purpose: "Send different details",
    }),
    { allowed: false, reason: "mismatched" },
  );

  const expiredStore = createStore(clock);
  const expired = expiredStore.propose(request);
  clock.now = 2_000;
  assert.deepEqual(expiredStore.confirm(expired.authorizationId, request.principalId, true), {
    allowed: false,
    reason: "expired",
  });
});

test("conversation boundaries allow general information and reject high-risk roles", () => {
  assert.equal(assessConversationBoundary("general-information").allowed, true);
  for (const boundary of [
    "medical-diagnosis",
    "medication-change",
    "high-risk-legal",
    "high-risk-financial",
    "emergency",
    "impersonation",
  ] as const) {
    assert.equal(assessConversationBoundary(boundary).allowed, false);
  }
});

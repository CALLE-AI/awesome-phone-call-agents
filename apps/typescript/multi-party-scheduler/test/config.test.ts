import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, POLICY_LIMITS, parseRequest, worstCaseCalls } from "../src/config.js";
import { coordinationRequest, requestInput, TENANT } from "./fixtures.js";

function expectError(input: unknown, fragment: string): void {
  assert.throws(
    () => parseRequest(input),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
      assert.match(error.message, new RegExp(fragment, "i"));
      return true;
    },
  );
}

test("a valid request resolves policy defaults and keeps call order", () => {
  const request = coordinationRequest();
  assert.equal(request.policy.windowMinutes, POLICY_LIMITS.windowMinutes.default);
  assert.equal(request.policy.minConfidence, POLICY_LIMITS.minConfidence.default);
  assert.deepEqual(
    request.parties.map((party) => party.id),
    ["plumber", "tenant", "superintendent"],
  );
  assert.equal(worstCaseCalls(request), 8);
});

test("a party without recorded consent is refused", () => {
  const parties = requestInput().parties.map((party) => ({ ...party }) as Record<string, unknown>);
  delete parties[1]!.consent_recorded;
  expectError(requestInput({ parties: parties as never }), "consent_recorded must be true");
  parties[1]!.consent_recorded = false;
  expectError(requestInput({ parties: parties as never }), "consent_recorded must be true");
});

test("a calling window that is not a real window is refused", () => {
  const parties = requestInput().parties.map((party) => ({ ...party }));
  parties[0]!.calling_hours = { start: "21:00", end: "07:00" };
  expectError(requestInput({ parties }), "must be earlier than");
  parties[0]!.calling_hours = { start: "9am", end: "18:00" };
  expectError(requestInput({ parties }), "HH:MM");
  parties[0]!.calling_hours = { start: "09:00", end: "18:00", timezone: "PDT" };
  expectError(requestInput({ parties }), "IANA name");
});

test("calling hours fall back to a daytime window in the meeting timezone", () => {
  const parties = requestInput().parties.map((party) => ({ ...party }) as Record<string, unknown>);
  delete parties[0]!.calling_hours;
  const request = parseRequest(requestInput({ parties: parties as never }));
  assert.equal(request.parties[0]!.callingHours.start, "09:00");
  assert.equal(request.parties[0]!.callingHours.end, "20:00");
  assert.equal(request.parties[0]!.callingHours.timezone, "America/Los_Angeles");
});

test("a phone number that is not E.164 is refused", () => {
  const parties = requestInput().parties.map((party) => ({ ...party }));
  parties[0]!.phone = "415 555 0101";
  expectError(requestInput({ parties }), "E.164");
});

test("one party is a phone call, not a protocol", () => {
  expectError(requestInput({ parties: [requestInput().parties[0]!] }), "between 2 and 6");
});

test("more than six parties is refused", () => {
  const base = requestInput().parties[0]!;
  const parties = Array.from({ length: 7 }, (_, index) => ({
    ...base,
    id: `p${index}`,
    phone: `+1415555010${index}`,
  }));
  expectError(requestInput({ parties }), "between 2 and 6");
});

test("duplicate party ids and duplicate numbers are refused", () => {
  const base = requestInput().parties[0]!;
  expectError(requestInput({ parties: [base, { ...base, phone: TENANT }] }), "unique ids");
  expectError(requestInput({ parties: [base, { ...base, id: "other" }] }), "unique phone numbers");
});

test("a call budget below the worst case is refused before any call is placed", () => {
  expectError(requestInput({ policy: { max_calls: 6 } }), "can need 8 calls");
});

test("a purpose too long to read out loud is refused", () => {
  expectError(
    requestInput({
      meeting: { ...requestInput().meeting, purpose: "x".repeat(200) },
    }),
    "characters or fewer",
  );
});

test("a missing timezone or a silly duration is refused", () => {
  const meeting = { ...requestInput().meeting } as Record<string, unknown>;
  delete meeting.timezone;
  expectError(requestInput({ meeting: meeting as never }), "meeting.timezone");
  expectError(
    requestInput({ meeting: { ...requestInput().meeting, duration_minutes: 600 } }),
    "between 5 and 480",
  );
});

test("a window outside the policy limits is refused", () => {
  expectError(requestInput({ policy: { window_minutes: 600 } }), "between 5 and 180");
});

test("slot problems are reported as request errors", () => {
  expectError(
    requestInput({ slots: [{ id: "only", start: "2026-08-06T10:00:00-07:00" }] }),
    "between 2 and 4",
  );
});

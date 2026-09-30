// Gate unit tests. Run with `npm test`. No credentials, no network, no calls.

import test from "node:test";
import assert from "node:assert/strict";

import { checkAccount, isQuietHour, isValidTimeZone, localHour, DEFAULT_GATE } from "./gate.js";
import type { OverdueAccount } from "./types.js";

const base: OverdueAccount = {
  accountId: "T-1",
  customerName: "Test Person",
  phone: "+12025550143",
  region: "US",
  timezone: "America/New_York",
  amountDueCents: 10000,
  currency: "USD",
  dueDate: "2026-07-15",
  daysPastDue: 10,
  consentToContact: true,
  consentTimestamp: "2026-06-01T10:00:00Z",
};

// 2026-08-10T15:00:00Z == 11:00 in New York (EDT) -> business hours.
const daytime = new Date("2026-08-10T15:00:00Z");
// 2026-08-10T04:00:00Z == 00:00 in New York -> quiet hours.
const midnight = new Date("2026-08-10T04:00:00Z");

test("allows a consented, valid account during business hours", () => {
  assert.deepEqual(checkAccount(base, { ...DEFAULT_GATE, now: daytime }), { allowed: true });
});

test("blocks when consent is missing", () => {
  const d = checkAccount({ ...base, consentToContact: false }, { ...DEFAULT_GATE, now: daytime });
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, "no-consent");
});

test("blocks when consent timestamp is absent", () => {
  const acct = { ...base, consentTimestamp: undefined };
  const d = checkAccount(acct, { ...DEFAULT_GATE, now: daytime });
  assert.equal(d.allowed === false && d.reason, "missing-consent-timestamp");
});

test("blocks a non-E.164 phone", () => {
  const d = checkAccount({ ...base, phone: "0202555017" }, { ...DEFAULT_GATE, now: daytime });
  assert.equal(d.allowed === false && d.reason, "invalid-e164-phone");
});

test("blocks an invalid IANA timezone", () => {
  const d = checkAccount({ ...base, timezone: "Mars/Phobos" }, { ...DEFAULT_GATE, now: daytime });
  assert.equal(d.allowed === false && d.reason, "invalid-iana-timezone");
});

test("blocks during quiet hours", () => {
  const d = checkAccount(base, { ...DEFAULT_GATE, now: midnight });
  assert.equal(d.allowed, false);
  assert.match(d.allowed === false ? d.reason : "", /^quiet-hours-local-/);
});

test("isQuietHour handles the midnight-wrapping window", () => {
  assert.equal(isQuietHour(23, DEFAULT_GATE), true);
  assert.equal(isQuietHour(3, DEFAULT_GATE), true);
  assert.equal(isQuietHour(12, DEFAULT_GATE), false);
});

test("isValidTimeZone accepts IANA ids and rejects junk", () => {
  assert.equal(isValidTimeZone("Africa/Accra"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
});

test("localHour resolves a timezone to a 0-23 hour", () => {
  const h = localHour("America/New_York", daytime);
  assert.ok(h >= 0 && h <= 23);
  assert.equal(h, 11);
});

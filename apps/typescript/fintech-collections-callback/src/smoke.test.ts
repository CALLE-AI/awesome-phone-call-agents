// Tests for the SMOKE_* env -> account builder. No network, no calls.

import test from "node:test";
import assert from "node:assert/strict";

import { buildSmokeAccount, isoDateDaysAgo } from "./smoke.js";

test("buildSmokeAccount throws when SMOKE_PHONE is absent", () => {
  assert.throws(() => buildSmokeAccount({}), /SMOKE_PHONE is required/);
});

test("consent is OFF by default so the gate blocks unless asserted", () => {
  const acct = buildSmokeAccount({ SMOKE_PHONE: "+12025550143" });
  assert.equal(acct.consentToContact, false);
  assert.equal(acct.consentTimestamp, undefined);
});

test("SMOKE_CONSENT=true attaches a consent timestamp (defaults to now)", () => {
  const acct = buildSmokeAccount({ SMOKE_PHONE: "+12025550143", SMOKE_CONSENT: "true" });
  assert.equal(acct.consentToContact, true);
  assert.ok(acct.consentTimestamp, "expected a consent timestamp");
  assert.ok(!Number.isNaN(Date.parse(acct.consentTimestamp!)), "timestamp should be ISO-parseable");
});

test("an explicit consent timestamp is preserved", () => {
  const acct = buildSmokeAccount({
    SMOKE_PHONE: "+12025550143",
    SMOKE_CONSENT: "true",
    SMOKE_CONSENT_TIMESTAMP: "2026-01-02T03:04:05Z",
  });
  assert.equal(acct.consentTimestamp, "2026-01-02T03:04:05Z");
});

test("overrides are respected; sensible defaults otherwise", () => {
  const acct = buildSmokeAccount({
    SMOKE_PHONE: "+441632960001",
    SMOKE_NAME: "Alex Doe",
    SMOKE_REGION: "GB",
    SMOKE_TIMEZONE: "Europe/London",
    SMOKE_AMOUNT_CENTS: "42000",
    SMOKE_CURRENCY: "GBP",
    SMOKE_DAYS_PAST_DUE: "12",
    SMOKE_LANGUAGE: "en-GB",
  });
  assert.equal(acct.customerName, "Alex Doe");
  assert.equal(acct.region, "GB");
  assert.equal(acct.timezone, "Europe/London");
  assert.equal(acct.amountDueCents, 42000);
  assert.equal(acct.currency, "GBP");
  assert.equal(acct.daysPastDue, 12);
  assert.equal(acct.language, "en-GB");
  assert.equal(acct.accountId, "SMOKE-1"); // default
});

test("isoDateDaysAgo returns a YYYY-MM-DD date the given number of days back", () => {
  const from = new Date("2026-08-10T00:00:00Z");
  assert.equal(isoDateDaysAgo(30, from), "2026-07-11");
  assert.match(isoDateDaysAgo(30), /^\d{4}-\d{2}-\d{2}$/);
});

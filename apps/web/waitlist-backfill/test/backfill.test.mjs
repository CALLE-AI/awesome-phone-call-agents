/**
 * Runs with no credentials, no network and no dependencies:
 *
 *   node --test test/
 *
 * The assertions that matter most are the negative ones: that a call was NOT placed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  checkConsent,
  checkContentBoundaries,
  checkFrequencyCap,
  checkQuietHours,
  isE164,
  localTimeIn,
  maskPhone,
  redactPhones,
  resolveTimeZone,
} from "../src/guardrails.mjs";
import { FakeCalleClient, buildTask, classifyTransportError } from "../src/calle.mjs";
import { idempotencyKey, runBackfill } from "../src/backfill.mjs";

const scenario = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/scenario.sample.json", import.meta.url)), "utf8"),
);
const NOW = new Date(scenario.demoNow);

const contact = (id) => scenario.waitlist.find((c) => c.id === id);

function baseRun(overrides = {}) {
  const client = new FakeCalleClient(scenario.scriptedAnswers);
  return {
    client,
    args: {
      slot: scenario.slot,
      waitlist: scenario.waitlist,
      policy: scenario.policy,
      history: scenario.history,
      client,
      message: scenario.message,
      request: { mode: "live", confirmSlotId: scenario.slot.id },
      now: NOW,
      ...overrides,
    },
  };
}

test("E.164 validation accepts real shapes and rejects the usual mistakes", () => {
  assert.ok(isE164("+15550100178"));
  assert.ok(isE164("+442071838750"));
  assert.ok(!isE164("5550100178"), "no plus");
  assert.ok(!isE164("+0550100178"), "country code cannot start with 0");
  assert.ok(!isE164("+1 555 010 0178"), "spaces are not E.164");
  assert.ok(!isE164("+1555010017812345"), "too long");
  assert.ok(!isE164(null));
});

test("masking keeps the country code and last two digits only", () => {
  assert.equal(maskPhone("+15550100178"), "+1********78");
  assert.ok(!maskPhone("+15550100178").includes("5550100"));
});

test("timezone must be an explicit IANA zone: no offsets, no abbreviations, no guessing", () => {
  assert.equal(resolveTimeZone("America/New_York").ok, true);
  assert.equal(resolveTimeZone(null).code, "timezone_missing");
  assert.equal(resolveTimeZone("").code, "timezone_missing");
  assert.equal(resolveTimeZone("EST").code, "timezone_not_iana");
  assert.equal(resolveTimeZone("UTC+5").code, "timezone_not_iana");
  assert.equal(resolveTimeZone("-05:00").code, "timezone_not_iana");
  assert.equal(resolveTimeZone("Mars/Olympus").code, "timezone_unknown");
});

test("quiet hours are judged in the contact's zone, not the server's", () => {
  // One instant, two people. 21:30 in New York is 18:30 in Los Angeles.
  const at = new Date("2026-09-03T01:30:00Z");
  const policy = scenario.policy.quietHours;
  const east = checkQuietHours({ timeZone: "America/New_York" }, policy, at);
  const west = checkQuietHours({ timeZone: "America/Los_Angeles" }, policy, at);
  assert.equal(east.allowed, false);
  assert.equal(east.code, "quiet_hours");
  assert.equal(west.allowed, true);
});

test("a contact with no timezone is refused, never assumed from the dialling code", () => {
  const r = checkQuietHours(contact("c_lindqvist"), scenario.policy.quietHours, NOW);
  assert.equal(r.allowed, false);
  assert.equal(r.code, "timezone_missing");
});

test("Sunday is outside the permitted calling days", () => {
  const sunday = new Date("2026-09-06T16:00:00Z"); // 12:00 in New York
  assert.equal(localTimeIn("America/New_York", sunday).weekday, "Sun");
  const r = checkQuietHours({ timeZone: "America/New_York" }, scenario.policy.quietHours, sunday);
  assert.equal(r.code, "outside_calling_days");
});

test("consent must exist, be un-revoked, and cover this scope", () => {
  assert.equal(checkConsent(contact("c_whitfield"), "appointment_offers").allowed, true);
  assert.equal(checkConsent(contact("c_abara"), "appointment_offers").code, "consent_revoked");
  assert.equal(checkConsent({}, "appointment_offers").code, "no_consent_on_file");
  assert.equal(checkConsent(contact("c_whitfield"), "marketing").code, "consent_scope_mismatch");
});

test("frequency cap counts only calls inside the rolling window", () => {
  const p = scenario.policy.frequency;
  assert.equal(checkFrequencyCap(scenario.history, "c_watanabe", p, NOW).code, "frequency_cap");
  assert.equal(checkFrequencyCap(scenario.history, "c_whitfield", p, NOW).allowed, true);
  // Same two calls, but long enough ago to have aged out.
  const later = new Date(NOW.getTime() + 30 * 24 * 3600_000);
  assert.equal(checkFrequencyCap(scenario.history, "c_watanabe", p, later).allowed, true);
});

test("operator message cannot smuggle in medical, legal, financial or emergency content", () => {
  assert.equal(checkContentBoundaries(scenario.message).allowed, true);
  assert.equal(
    checkContentBoundaries("Take 400mg before you arrive.").code,
    "boundary_medical_advice",
  );
  assert.equal(
    checkContentBoundaries("If you feel faint call 911 immediately.").code,
    "boundary_emergency_handling",
  );
});

test("the call task restates the boundaries to the agent", () => {
  const task = buildTask({ slot: scenario.slot, contact: contact("c_whitfield"), message: scenario.message });
  assert.match(task, /Do not give medical, legal or financial advice/);
  assert.match(task, /emergency/i);
  assert.match(task, /Do not negotiate a different time/);
});

test("preview mode places zero calls, whatever the waitlist says", async () => {
  const { client, args } = baseRun({ request: { mode: "preview" } });
  const result = await runBackfill(args);
  assert.equal(client.placed.length, 0);
  assert.equal(result.callsPlaced, 0);
  assert.equal(result.filled, false);
  assert.ok(result.events.some((e) => e.type === "contact_would_call"));
});

test("live mode is refused unless the intent names this exact slot", async () => {
  const { client, args } = baseRun({ request: { mode: "live", confirmSlotId: "slot_wrong" } });
  const result = await runBackfill(args);
  assert.equal(client.placed.length, 0, "a mismatched confirmation must not place calls");
  assert.equal(result.events[0].mode, "preview");
});

test("the run stops at the first yes and never calls anyone behind them", async () => {
  const { client, args } = baseRun();
  const result = await runBackfill(args);

  assert.equal(result.filled, true);
  assert.equal(result.filledBy.id, "c_oyelaran");

  // Two calls: Whitfield said no, Oyelaran said yes.
  assert.deepEqual(client.placed.map((p) => p.contactId), ["c_whitfield", "c_oyelaran"]);

  // Raman is scripted to say yes but is behind the acceptance, so she is never rung.
  assert.ok(!client.placed.some((p) => p.contactId === "c_raman"));
  const suppressed = result.events.filter((e) => e.type === "contact_suppressed");
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].contactId, "c_raman");
});

test("each guardrail fires once, with a distinct machine-readable reason", async () => {
  const { args } = baseRun();
  const result = await runBackfill(args);
  const skips = Object.fromEntries(
    result.events.filter((e) => e.type === "contact_skipped").map((e) => [e.contactId, e.code]),
  );
  assert.deepEqual(skips, {
    c_lindqvist: "timezone_missing",
    c_abara: "consent_revoked",
    c_watanabe: "frequency_cap",
  });
});

test("no unmasked phone number appears anywhere in the emitted events", async () => {
  const { args } = baseRun();
  const result = await runBackfill(args);
  const blob = JSON.stringify(result);
  for (const c of scenario.waitlist) {
    assert.ok(!blob.includes(c.phone), `raw number for ${c.id} leaked into the audit trail`);
  }
});

test("cancellation stops the loop before the next call", async () => {
  const { client, args } = baseRun();
  let calls = 0;
  const result = await runBackfill({
    ...args,
    isCancelled: () => calls++ >= 4, // allow the three skips and Whitfield, then cancel
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.filled, false);
  assert.deepEqual(client.placed.map((p) => p.contactId), ["c_whitfield"]);
});

test("a fake transport never announces that real calls will be placed", async () => {
  const { args } = baseRun();
  const result = await runBackfill(args);
  const started = result.events[0];
  assert.equal(started.mode, "live");
  assert.equal(started.transport, "fake");
  assert.ok(
    !/real calls will be placed/i.test(started.detail),
    "the run banner must not claim real calls on a fake transport",
  );
  assert.match(started.detail, /simulated/i);
});

test("idempotency keys are stable, so a re-run cannot double-call", () => {
  const c = contact("c_whitfield");
  assert.equal(idempotencyKey(scenario.slot, c), idempotencyKey(scenario.slot, c));
  assert.notEqual(idempotencyKey(scenario.slot, c), idempotencyKey(scenario.slot, contact("c_raman")));
});

/*
 * THE DOUBLE-BOOKING GUARD.
 *
 * These two tests are the reason the loop exists in this shape. A failure that might have left a
 * call running must stop everything, because the alternative is two calls in flight for one slot
 * and one appointment promised to two people. A failure that definitely placed no call is allowed
 * to move on, because stopping there would strand the slot for no reason.
 */

test("an ambiguous transport failure HALTS the run rather than calling the next person", async () => {
  const client = new FakeCalleClient(scenario.scriptedAnswers);
  client.placeCall = async ({ contact: c }) => {
    // No status: we never learned whether the provider accepted this call.
    if (c.id === "c_whitfield") throw new Error("socket hang up");
    client.placed.push({ contactId: c.id });
    return { id: "x", status: "completed", structuredResult: { can_take_slot: "yes" } };
  };
  const { args } = baseRun();
  const result = await runBackfill({ ...args, client });

  assert.equal(result.halted, true);
  assert.equal(result.haltCode, "call_outcome_unknown");
  assert.equal(result.filled, false, "an unknown outcome must never be read as an acceptance");
  assert.deepEqual(client.placed, [], "nobody behind the ambiguous call may be rung");

  const halt = result.events.find((e) => e.type === "run_halted");
  assert.ok(halt, "the run must say why it stopped");
  assert.equal(halt.reconcileRequired, true);
  // The operator needs the key to go and look the call up at the provider.
  assert.equal(result.reconcileKey, idempotencyKey(scenario.slot, contact("c_whitfield")));
});

test("a definitive rejection skips that person and the run carries on", async () => {
  const client = new FakeCalleClient(scenario.scriptedAnswers);
  client.placeCall = async ({ contact: c }) => {
    if (c.id === "c_whitfield") {
      const err = new Error("recipient number is not callable");
      err.status = 422; // the API refused it outright, so no call was ever created
      throw err;
    }
    client.placed.push({ contactId: c.id });
    return { id: "x", status: "completed", structuredResult: { can_take_slot: "yes" } };
  };
  const { args } = baseRun();
  const result = await runBackfill({ ...args, client });

  assert.equal(result.halted, false);
  assert.ok(result.events.some((e) => e.type === "call_failed" && e.code === "call_rejected"));
  assert.equal(result.filledBy.id, "c_oyelaran", "the run moved on to the next person");
});

test("an auth failure stops the run: every later call would fail the same way", async () => {
  const client = new FakeCalleClient(scenario.scriptedAnswers);
  client.placeCall = async () => {
    const err = new Error("invalid api key");
    err.status = 401;
    throw err;
  };
  const { args } = baseRun();
  const result = await runBackfill({ ...args, client });
  assert.equal(result.halted, true);
  assert.equal(result.haltCode, "transport_not_authorised");
  // Nothing was placed, so there is nothing to reconcile.
  assert.equal(result.reconcileKey, null);
});

test("classification is fail-closed: an unrecognised failure counts as ambiguous", () => {
  assert.equal(classifyTransportError(new Error("???")).ambiguous, true);
  assert.equal(classifyTransportError({ status: 500 }).ambiguous, true);
  assert.equal(classifyTransportError({ status: 429 }).ambiguous, true);
  assert.equal(classifyTransportError({ status: 408 }).ambiguous, true);
  assert.equal(classifyTransportError({ name: "CalleTimeoutError" }).ambiguous, true);
  assert.equal(classifyTransportError({ status: 422 }).ambiguous, false);
});

test("consent fails closed when the scope is missing or malformed", () => {
  const granted = (consent) => checkConsent({ consent }, "appointment_offers");
  // The bug this replaces: a record with only a grantedAt was treated as callable, because the
  // scope check skipped itself whenever `scopes` was not an array.
  assert.equal(granted({ grantedAt: "2026-01-01" }).allowed, false);
  assert.equal(granted({ grantedAt: "2026-01-01" }).code, "consent_scope_missing");
  assert.equal(granted({ grantedAt: "2026-01-01", scopes: "appointment_offers" }).allowed, false);
  assert.equal(granted({ grantedAt: "2026-01-01", scopes: [] }).allowed, false);
  assert.equal(granted({ grantedAt: "2026-01-01", scopes: ["appointment_offers"] }).allowed, true);
  // A run with no configured scope cannot match anything, so it must not call.
  assert.equal(checkConsent({ consent: { grantedAt: "x", scopes: ["a"] } }, "").allowed, false);
});

test("phone-shaped text is redacted out of anything the provider wrote", () => {
  assert.equal(redactPhones("Called +15550100178 and got voicemail"),
    "Called +1********78 and got voicemail");
  assert.ok(!redactPhones("dialled (555) 555-0100 twice").includes("555-0100"));
  assert.ok(!redactPhones("connect failed for 15550100178").includes("15550100178"));
  // Must not mangle ordinary content: timestamps, ids and small numbers survive intact.
  assert.equal(redactPhones("at 2026-09-03T01:30:00Z"), "at 2026-09-03T01:30:00Z");
  assert.equal(redactPhones("slot_2026_09 has 12 people"), "slot_2026_09 has 12 people");
  assert.equal(redactPhones(""), "");
});

test("a provider summary quoting the number does not reach the audit trail", async () => {
  const client = new FakeCalleClient(scenario.scriptedAnswers);
  const raw = contact("c_whitfield").phone;
  client.placeCall = async ({ contact: c }) => {
    client.placed.push({ contactId: c.id });
    return {
      id: "x",
      status: "completed",
      structuredResult: { can_take_slot: "yes" },
      summary: `Reached ${c.phone} and they accepted.`,
    };
  };
  const { args } = baseRun();
  const result = await runBackfill({ ...args, client });
  assert.ok(!JSON.stringify(result).includes(raw), "provider free text leaked the raw number");
});

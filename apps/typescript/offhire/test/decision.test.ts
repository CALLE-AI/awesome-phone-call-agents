import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileCall,
  summarizeRentals,
  invoiceReview,
} from "../src/core/decision";
import { compileCallPlan, callWindow } from "../src/core/call-plan";
import { demoRentals, fixtureCall } from "../src/core/fixtures";
import { rentalInput, type Extraction } from "../src/core/types";
const r = demoRentals("test")[0];
const setup = () => {
  const call = fixtureCall(r, "confirmed");
  return {
    call,
    e: call.structuredResult as Extraction,
    turns: call.recipients[0].attempts[0].transcriptTurns,
  };
};
test("explicit off-rent, reference and identity yield a reported cutoff, not physical collection", () => {
  const d = reconcileCall(fixtureCall(r, "confirmed"), r);
  assert.equal(d.billing, "reported_off_rent");
  assert.equal(d.pickup, "scheduled");
  assert.equal(d.reference, "OR-78416");
  assert.equal(d.disposition, "confirmed");
});
for (const scenario of [
  "ambiguous",
  "voicemail",
  "contradiction",
  "unsupported",
  "wrong_asset",
] as const)
  test(`${scenario} never closes billing`, () => {
    assert.notEqual(
      reconcileCall(fixtureCall(r, scenario), r).billing,
      "reported_off_rent",
    );
  });
test("completed CALL-E task can still be an unresolved commercial task", () => {
  const call = fixtureCall(r, "ambiguous");
  assert.equal(call.taskCompleted, true);
  const d = reconcileCall(call, r);
  assert.equal(d.pickup, "scheduled");
  assert.equal(d.billing, "unconfirmed");
});
test("taskCompleted=false alone does not invalidate explicit evidence", () => {
  const { call } = setup();
  call.taskCompleted = false;
  assert.equal(reconcileCall(call, r).billing, "reported_off_rent");
});
test("truncated affirmative before a negation cannot validate a field", () => {
  const { call, e, turns } = setup();
  turns[3].text = "Rental billing stops today? No, it does not.";
  e.billing_quote = "Rental billing stops today";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("agent words cannot serve as supplier proof", () => {
  const { call, turns } = setup();
  turns[3].speaker = "bot";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("unknown speaker cannot serve as supplier proof", () => {
  const { call, turns } = setup();
  turns[3].speaker = "unknown";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("a negative full-turn quotation is preserved and stays open", () => {
  const { call, e, turns } = setup();
  e.billing_quote = turns[3].text =
    "Billing is not stopped. Off-rent awaits dispatch.";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("a conditional statement does not become confirmed", () => {
  const { call, e, turns } = setup();
  e.billing_quote = turns[3].text =
    "Billing stops today if the driver collects it.";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("a caller-invented confirmation reference is rejected", () => {
  const { call, e } = setup();
  e.off_rent_reference = "OR-99999";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("missing readback stays open", () => {
  const { call, e } = setup();
  e.readback_confirmed = "unknown";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("wrong contract stays open", () => {
  const { call, e } = setup();
  e.contract_id = "CR-999";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("not an authorized representative stays open", () => {
  const { call, e } = setup();
  e.authorized_representative = "unknown";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("missing timezone stays open", () => {
  const { call, e } = setup();
  e.off_rent_at = "2026-09-14T15:00:00";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("unreasonably old cutoff relative to request stays open", () => {
  const { call, e } = setup();
  e.off_rent_at = "2026-08-14T15:00:00-05:00";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("missing structured result does not fabricate facts", () => {
  const { call } = setup();
  call.structuredResult = null;
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("malformed structured result does not fabricate facts", () => {
  const { call } = setup();
  call.structuredResult = { billing_status: true };
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("unexpected fields fail strict result validation", () => {
  const { call } = setup();
  call.structuredResult = {
    ...(call.structuredResult as object),
    status: "success",
  };
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("multiple attempts are not stitched into invented evidence", () => {
  const { call } = setup();
  call.recipients[0].attempts.push({ ...call.recipients[0].attempts[0] });
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
for (const status of [
  "queued",
  "in_progress",
  "failed",
  "canceled",
  "surprise",
])
  test(`${status} provider lifecycle never closes billing`, () => {
    const { call } = setup();
    call.status = status;
    assert.equal(reconcileCall(call, r).billing, "unconfirmed");
  });
test("failed calls cannot reuse a previous positive structured output", () => {
  const { call } = setup();
  call.status = "failed";
  call.failureCode = "no_answer";
  assert.equal(reconcileCall(call, r).disposition, "unreached");
});
test("quotation normalization permits case and whitespace but not fabricated content", () => {
  const { call, e } = setup();
  e.billing_quote = e.billing_quote.toUpperCase().replaceAll(" ", "  ");
  assert.equal(reconcileCall(call, r).billing, "reported_off_rent");
});
test("later stale old receipt cannot restore a newer unresolved state", () => {
  const rentals = demoRentals("test");
  const good = reconcileCall(fixtureCall(rentals[0], "confirmed"), rentals[0]);
  const bad = reconcileCall(fixtureCall(rentals[0], "ambiguous"), rentals[0]);
  const sum = summarizeRentals(
    [rentals[0]],
    [
      { rentalId: rentals[0].id, decision: bad, createdAt: "2026-09-15" },
      { rentalId: rentals[0].id, decision: good, createdAt: "2026-09-14" },
    ],
  );
  assert.equal(sum.confirmed, 0);
  assert.equal(sum.rates.USD, 185);
});
test("currencies are kept separate in rate metrics", () => {
  const rentals = demoRentals("test");
  rentals[1].currency = "INR";
  const sum = summarizeRentals(rentals, []);
  assert.equal(sum.rates.USD, 280);
  assert.equal(sum.rates.INR, 320);
});
test("collection is independently recorded even after reported off-rent", () => {
  const d = reconcileCall(fixtureCall(r, "confirmed"), r);
  const jobs = [{ rentalId: r.id, decision: d, createdAt: "2026-09-14" }];
  assert.equal(summarizeRentals([r], jobs).awaitingPickup, 1);
  assert.equal(
    summarizeRentals([{ ...r, collectedAt: new Date().toISOString() }], jobs)
      .awaitingPickup,
    0,
  );
});
test("invoice discrepancy produces a review, not a refund claim", () => {
  const d = reconcileCall(fixtureCall(r, "confirmed"), r);
  const review = invoiceReview("2026-09-15", d);
  assert.equal(review.flagged, true);
  assert.match(review.reason, /not proof of an overcharge/);
});
test("invoice same day does not create a discrepancy", () => {
  assert.equal(
    invoiceReview("2026-09-14", reconcileCall(fixtureCall(r, "confirmed"), r))
      .flagged,
    false,
  );
});
test("invoice without cutoff cannot generate a financial claim", () => {
  assert.equal(invoiceReview("2026-09-15", null).flagged, false);
});
test("invalid invoice date rejected", () => {
  assert.throws(() => invoiceReview("tomorrow", null));
});
test("call plan scopes one asset, includes disclosure and forbids new fees", () => {
  const plan = compileCallPlan({ ...r, phone: "+14155550123" }, "job");
  assert.equal(plan.recipients!.length, 1);
  assert.equal(plan.recipients![0].phones!.length, 1);
  assert.match(plan.task, /AI assistant/);
  assert.match(plan.task, /No purchases, fees/);
  assert.match(plan.task, /existing off-rent request/);
  assert.match(plan.task, /Never infer billing stopped from a pickup/);
});
test("schema contains no unsupported nullable unions or refs", () => {
  const schema = JSON.stringify(compileCallPlan(r, "job").resultSchema);
  assert.doesNotMatch(schema, /anyOf|oneOf|\$ref/);
});
test("test call explicitly names fictional scenario", () => {
  assert.match(
    compileCallPlan({ ...r, isTest: true }, "job").task,
    /No actual equipment or rental contract may be changed/,
  );
});
test("weekday office hours are timezone aware", () => {
  assert.equal(
    callWindow("America/Chicago", new Date("2026-09-14T14:00:00Z")).allowed,
    true,
  );
  assert.equal(
    callWindow("America/Chicago", new Date("2026-09-14T02:00:00Z")).allowed,
    false,
  );
  assert.equal(
    callWindow("America/Chicago", new Date("2026-09-13T15:00:00Z")).allowed,
    false,
  );
});
test("rental input rejects invalid timezone and malformed destination", () => {
  assert.equal(
    rentalInput.safeParse({ ...r, timezone: "Mars/City" }).success,
    false,
  );
  assert.equal(rentalInput.safeParse({ ...r, phone: "12345" }).success, false);
});
test("future extracted date contradicting the spoken date is rejected", () => {
  const { call, e } = setup();
  e.off_rent_at = "2099-09-14T15:00:00-05:00";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("unrelated billing inquiry is not an affirmative cutoff", () => {
  const { call, e, turns } = setup();
  e.billing_quote = turns[3].text = "I have received your billing inquiry.";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("negative identity statement cannot confirm a rental", () => {
  const { call, e, turns } = setup();
  e.identity_quote =
    turns[1].text = `I cannot verify asset ${r.assetId} on contract ${r.contract}.`;
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("identifier prefixes cannot stand in for complete identifiers", () => {
  const { call, e, turns } = setup();
  e.identity_quote = turns[1].text =
    "I confirm asset SL-2040 on contract CR-108420.";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("later continuing charges override earlier positive result", () => {
  const { call, turns } = setup();
  turns.push({
    speaker: "user",
    text: "Rental charges continue accruing on this contract.",
    offset_seconds: 80,
  });
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("extracted time must match callee statement", () => {
  const { call, e } = setup();
  e.off_rent_at = "2026-09-14T17:00:00-05:00";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("extracted offset must agree with supplier timezone and quoted time", () => {
  const { call, e } = setup();
  e.off_rent_at = "2026-09-14T15:00:00+05:30";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("a billing question cannot be promoted to a declarative confirmation", () => {
  const { call, e, turns } = setup();
  e.billing_quote = turns[3].text = e.billing_quote + "?";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("a bare negative before an otherwise affirmative sentence stays open", () => {
  const { call, e, turns } = setup();
  e.billing_quote = turns[3].text = "No, " + e.billing_quote;
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("invented readback flag does not replace a transcript readback", () => {
  const { call, turns } = setup();
  turns[4].text = "Great, thank you.";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("readback confirming a different reference stays open", () => {
  const { call, turns } = setup();
  turns[4].text = turns[4].text.replace("OR-78416", "OR-99999");
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("impossible calendar invoice dates rejected", () => {
  assert.throws(() => invoiceReview("2026-02-31", null));
});
test("pickup ticket cannot be used as an off-rent reference", () => {
  const { call, e, turns } = setup();
  e.reference_quote = turns[5].text =
    "Yes, that readback is correct. The collection ticket is OR-78416.";
  e.readback_quote = e.reference_quote;
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("unsupported seconds cannot be invented", () => {
  const { call, e } = setup();
  e.off_rent_at = "2026-09-14T15:00:59-05:00";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("pickup time cannot be assigned to the billing field in the same utterance", () => {
  const { call, e, turns } = setup();
  e.billing_quote = turns[3].text =
    "Rental billing stops on September 14, 2026 at 5:00 PM Central Daylight Time, and pickup is at 3:00 PM Central Daylight Time.";
  assert.equal(reconcileCall(call, r).billing, "unconfirmed");
});
test("outcome order follows reconciliation time, not plan creation order", () => {
  const good = reconcileCall(fixtureCall(r, "confirmed"), r);
  const bad = reconcileCall(fixtureCall(r, "voicemail"), r);
  const sum = summarizeRentals(
    [r],
    [
      {
        rentalId: r.id,
        decision: good,
        createdAt: "2026-09-14T01:00:00Z",
        updatedAt: "2026-09-14T04:00:00Z",
      },
      {
        rentalId: r.id,
        decision: bad,
        createdAt: "2026-09-14T02:00:00Z",
        updatedAt: "2026-09-14T03:00:00Z",
      },
    ],
  );
  assert.equal(sum.confirmed, 1);
});

test("collection status cannot be inferred from unrelated desk speech", () => {
  const { call, e, turns } = setup();
  e.pickup_quote = turns[7].text = "Our rental desk is open weekdays.";
  e.pickup_window = "September 30, 2026 at 11 PM";
  const d = reconcileCall(call, r);
  assert.equal(d.pickup, "unknown");
  assert.equal(d.pickupWindow, null);
  assert.equal(d.billing, "reported_off_rent");
});
test("collection window must be quoted rather than invented", () => {
  const { call, e } = setup();
  e.pickup_window = "September 30, 2026 at 11 PM";
  assert.equal(reconcileCall(call, r).pickup, "unknown");
});
test("scheduled collection cannot be promoted to physically collected", () => {
  const { call, e } = setup();
  e.pickup_status = "collected";
  assert.equal(reconcileCall(call, r).pickup, "unknown");
});
test("a later collection correction clears the collection projection", () => {
  const { call, turns } = setup();
  turns.push({
    speaker: "user",
    text: "Correction: collection is not booked yet.",
    offset_seconds: 80,
  });
  assert.equal(reconcileCall(call, r).pickup, "unknown");
});
test("collection window cannot borrow an unrelated date in a complete turn", () => {
  const { call, e, turns } = setup();
  e.pickup_quote = turns[7].text =
    e.pickup_quote + " Our office is closed on September 30, 2026 at 11 PM.";
  e.pickup_window = "September 30, 2026 at 11 PM";
  assert.equal(reconcileCall(call, r).pickup, "unknown");
});
for (const cancellation of [
  "canceled",
  "cancelled",
  "postponed",
  "rescheduled",
])
  test(`later ${cancellation} pickup clears prior schedule`, () => {
    const { call, turns } = setup();
    turns.push({
      speaker: "user",
      text: `The pickup has been ${cancellation}.`,
      offset_seconds: 80,
    });
    assert.equal(reconcileCall(call, r).pickup, "unknown");
  });

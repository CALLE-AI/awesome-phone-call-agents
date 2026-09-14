import assert from "node:assert/strict";
import { test } from "node:test";
import { findBooking, loadCatalog } from "../src/data.ts";
import { addMinutes } from "../src/format.ts";
import { quoteFor, voluntaryQuoteFor } from "../src/rules.ts";
import type { Disruption } from "../src/types.ts";

const catalog = loadCatalog();

function delay(minutes: number): Disruption {
  return {
    id: "evt_test",
    flightId: "NA721-2026-09-20",
    kind: "delay",
    cause: "operational",
    delayMinutes: minutes,
    reason: "test",
    newDeparture: addMinutes("2026-09-20T08:10:00+07:00", minutes),
    source: { kind: "manual" },
    createdAt: "2026-09-19T00:00:00Z",
  };
}

test("delays at or past the airline threshold are involuntary", () => {
  const booking = findBooking(catalog, "K7Q2XA");
  assert.equal(quoteFor(catalog, booking, delay(119)).changeCase, "voluntary");
  assert.equal(quoteFor(catalog, booking, delay(120)).changeCase, "involuntary");
});

test("involuntary refund is full fare minus middlemen that still charge", () => {
  // TripKita -> Lintas -> Samudra -> airline, saver fare 1,680,000
  const quote = quoteFor(catalog, findBooking(catalog, "M3P8RD"), delay(240));
  assert.deepEqual(
    quote.refund.lines.map((l) => [l.party, l.amount]),
    [
      ["TripKita", 0],
      ["Lintas Consolidator", -25000],
      ["Samudra Travel Wholesale", -50000],
    ],
  );
  assert.equal(quote.refund.amount, 1_605_000);
});

test("a distributor that never waives fees makes an involuntary move cost money", () => {
  const quote = quoteFor(catalog, findBooking(catalog, "M3P8RD"), delay(240));
  for (const move of quote.moves) assert.equal(move.total, 35_000);
});

test("voluntary pricing applies airline fee, fare difference, and every admin fee", () => {
  // basic fare 1,320,000 via TripKita -> Lintas; NA 725 basic costs 1,450,000
  const quote = quoteFor(catalog, findBooking(catalog, "T5W1LC"), delay(90));
  const na725 = quote.moves.find((m) => m.flightId === "NA725-2026-09-20");
  assert.ok(na725);
  assert.equal(na725.total, 500_000 + 130_000 + 30_000 + 50_000);
  assert.equal(quote.refund.amount, 0, "basic fares are non-refundable on a voluntary change");
});

test("only later flights on the same route with seats are offered", () => {
  const quote = quoteFor(catalog, findBooking(catalog, "K7Q2XA"), delay(240));
  assert.deepEqual(
    quote.moves.map((m) => m.flightId),
    ["NA725-2026-09-20", "NA729-2026-09-20", "NA721-2026-09-21"],
  );
  const noSeats = { ...catalog, flights: catalog.flights.map((f) => (f.id === "NA725-2026-09-20" ? { ...f, seatsAvailable: 0 } : f)) };
  assert.ok(!quoteFor(noSeats, findBooking(catalog, "K7Q2XA"), delay(240)).moves.some((m) => m.flightId === "NA725-2026-09-20"));
});

test("a passenger-requested change is always priced as voluntary, whatever the delay rules say", () => {
  const booking = findBooking(catalog, "M3P8RD");
  const quote = voluntaryQuoteFor(catalog, booking);
  assert.equal(quote.changeCase, "voluntary");
  assert.equal(quote.keep?.newDeparture, "2026-09-20T08:10:00+07:00");
  assert.deepEqual(quote, quoteFor(catalog, booking, { ...delay(90), newDeparture: "2026-09-20T08:10:00+07:00" }));
});

function cancelled(cause: Disruption["cause"]): Disruption {
  return { ...delay(0), kind: "cancellation", cause, delayMinutes: 0, newDeparture: null };
}

test("a cancellation is involuntary whatever the delay threshold, and has nothing to keep", () => {
  const quote = quoteFor(catalog, findBooking(catalog, "T5W1LC"), cancelled("operational"));
  assert.equal(quote.changeCase, "involuntary");
  assert.equal(quote.keep, null);
  // basic fare via TripKita -> Lintas: every fee waived except Lintas' involuntary refund fee
  assert.equal(quote.refund.amount, 1_320_000 - 25_000);
  assert.ok(quote.moves.every((m) => m.total === 0));
});

test("force majeure waives the change fee but still charges the fare difference", () => {
  const booking = findBooking(catalog, "T5W1LC"); // basic, paid 1,320,000
  const fmDelay = quoteFor(catalog, booking, { ...delay(240), cause: "force_majeure" });
  assert.equal(fmDelay.changeCase, "force_majeure");
  const na725 = fmDelay.moves.find((m) => m.flightId === "NA725-2026-09-20");
  assert.ok(na725);
  assert.deepEqual(
    na725.lines.map((l) => [l.label, l.amount]),
    [
      ["Change fee (waived, force majeure)", 0],
      ["Fare difference", 130_000],
      ["Reschedule admin fee", 0],
      ["Reschedule admin fee", 0],
    ],
  );
  assert.equal(quoteFor(catalog, booking, cancelled("force_majeure")).changeCase, "force_majeure");
  assert.equal(quoteFor(catalog, booking, { ...delay(60), cause: "force_majeure" }).changeCase, "voluntary", "a short delay is still voluntary");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallGateway, StartRequest, StartResult } from "../src/calle.ts";
import { DryRunGateway } from "../src/calle.ts";
import { findBooking, loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";
import { maskPhone, routeFor } from "../src/phone.ts";
import { quoteFor } from "../src/rules.ts";
import { buildResultSchema, buildTask } from "../src/task.ts";
import type { CallOutcome } from "../src/types.ts";

function dryDesk() {
  return new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0 });
}

test("dry run: every passenger ends applied or in review, never silently dropped", async () => {
  const desk = dryDesk();
  const d = desk.reportDelay("NA721-2026-09-20", 240, "a late inbound aircraft");
  const statuses: Record<string, string> = {};
  for (const pnr of ["K7Q2XA", "M3P8RD", "T5W1LC", "B9H4ZN", "R2D6YU"]) {
    await desk.startCall(d.id, pnr);
    statuses[pnr] = (await desk.refresh(`${d.id}:${pnr}`)).status;
  }
  assert.deepEqual(statuses, {
    K7Q2XA: "applied",
    M3P8RD: "applied",
    T5W1LC: "applied",
    B9H4ZN: "needs_review",
    R2D6YU: "needs_review",
  });
  const snap = desk.snapshot();
  const sari = snap.disruptions[0]?.bookings.find((b) => b.pnr === "T5W1LC");
  assert.equal(sari?.state?.status, "rebooked");
  assert.equal(sari?.state?.flightId, "NA729-2026-09-20");
  assert.notEqual(sari?.state?.currentPnr, "T5W1LC");
  assert.equal(snap.flights.find((f) => f.id === "NA729-2026-09-20")?.seatsAvailable, 8);
});

test("a booking is called at most once per disruption", async () => {
  const desk = dryDesk();
  const d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  await desk.startCall(d.id, "K7Q2XA");
  await assert.rejects(desk.startCall(d.id, "K7Q2XA"), /already called/);
});

test("a person can resolve a review item with an offered option", async () => {
  const desk = dryDesk();
  const d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  await desk.startCall(d.id, "B9H4ZN");
  const key = `${d.id}:B9H4ZN`;
  assert.equal((await desk.refresh(key)).status, "needs_review");
  const resolved = desk.resolve(key, { kind: "move", optionId: "NA729-2026-09-20" }, "Called back by agent");
  assert.equal(resolved.status, "resolved_by_human");
  assert.match(resolved.applied ?? "", /Rebooked to NA 729/);
});

class RecordingGateway implements CallGateway {
  readonly mode = "sdk" as const;
  readonly live = true;
  readonly firstPollSeconds = 60;
  readonly pollSeconds = 10;
  requests: StartRequest[] = [];
  constructor(private readonly result: StartResult) {}
  async start(request: StartRequest): Promise<StartResult> {
    this.requests.push(request);
    return this.result;
  }
  async get(): Promise<CallOutcome> {
    throw new Error("not polled in this test");
  }
}

test("live mode dials only the configured demo phone, after typed confirmation, within budget", async () => {
  const gateway = new RecordingGateway({ kind: "started", callId: "call_1" });
  const desk = new Desk(loadCatalog(), gateway, { statePath: null, liveDemoPhone: "+6591234567", liveCallBudget: 1 });
  const d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  await assert.rejects(desk.startCall(d.id, "K7Q2XA"), /last 4 digits/);
  await assert.rejects(desk.startCall(d.id, "K7Q2XA", "0101"), /last 4 digits/);
  const entry = await desk.startCall(d.id, "K7Q2XA", "4567");
  assert.equal(entry.status, "in_progress");
  assert.equal(gateway.requests[0]?.phone, "+6591234567");
  assert.equal(gateway.requests[0]?.region, "SG");
  assert.match(gateway.requests[0]?.idempotencyKey ?? "", /^fda-[0-9a-f]{8}-evt_NA721-2026-09-20_240-K7Q2XA$/);
  await assert.rejects(desk.startCall(d.id, "M3P8RD", "4567"), /budget/);
});

test("an uncertain submission is never retried automatically", async () => {
  const gateway = new RecordingGateway({ kind: "uncertain", message: "timeout" });
  const desk = new Desk(loadCatalog(), gateway, { statePath: null, liveDemoPhone: "+6591234567", liveCallBudget: 5 });
  const d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  assert.equal((await desk.startCall(d.id, "K7Q2XA", "4567")).status, "uncertain");
  await assert.rejects(desk.startCall(d.id, "K7Q2XA", "4567"), /already called/);
  assert.equal(gateway.requests.length, 1);
});

test("Indonesian numbers are refused and live mode will not start with one", () => {
  const route = routeFor("+628123456789");
  assert.equal(route.ok, false);
  assert.throws(
    () => new Desk(loadCatalog(), new RecordingGateway({ kind: "started", callId: "x" }), { statePath: null, liveDemoPhone: "+628123456789", liveCallBudget: 1 }),
    /Indonesia/,
  );
  assert.equal(maskPhone("+6591234567"), "+65 ••• 4567");
});

test("the task discloses the AI, states exact amounts, and forbids payment details", () => {
  const catalog = loadCatalog();
  const booking = findBooking(catalog, "M3P8RD");
  const disruption = {
    id: "evt",
    flightId: booking.flightId,
    kind: "delay" as const,
    cause: "operational" as const,
    source: { kind: "manual" as const },
    delayMinutes: 240,
    reason: "weather",
    newDeparture: "2026-09-20T05:10:00.000Z",
    createdAt: "",
  };
  const quote = quoteFor(catalog, booking, disruption);
  const task = buildTask(catalog, booking, disruption, quote);
  assert.match(task, /You are an AI assistant calling on behalf of TripKita/);
  assert.match(task, /1,605,000 rupiah/);
  assert.match(task, /Never ask for or accept card numbers/);
  const schema = buildResultSchema(quote) as { properties: { selected_flight: { enum: string[] } } };
  assert.deepEqual(schema.properties.selected_flight.enum, [...quote.moves.map((m) => m.flightId), "none"]);
});

test("live mode sends the request's passenger call to the demo phone only, and the airline waits for it", async () => {
  const gateway = new RecordingGateway({ kind: "started", callId: "call_passenger" });
  const now = () => new Date("2026-09-19T08:00:00+07:00").getTime();
  const desk = new Desk(loadCatalog(), gateway, { statePath: null, liveDemoPhone: "+6591234567", liveCallBudget: 2, now });
  const id = desk.submitRequest("P3X9GA", "reschedule", "NA729-2026-09-20", "chat").request.id;
  const preview = desk.previewPassengerCall(id);
  assert.equal(preview.redirected, true);
  assert.equal(preview.destinationMasked, "+65 ••• 4567");
  await assert.rejects(desk.callPassengerForRequest(id), /last 4 digits/);
  assert.equal((await desk.callPassengerForRequest(id, "4567")).status, "passenger_call_in_progress");
  assert.equal(gateway.requests[0]?.phone, "+6591234567");
  assert.match(gateway.requests[0]?.idempotencyKey ?? "", /^fda-[0-9a-f]{8}-req_P3X9GA_1-passenger$/);
  assert.equal(gateway.requests[0]?.metadata.purpose, "request_intake");
  await assert.rejects(desk.callAirlineDesk(id, "4567"), /only after the passenger agreed/);
  assert.equal(gateway.requests.length, 1);
});

test("a cancellation is called like a delay, offers no keep option, and never keeps the booking", async () => {
  const desk = dryDesk();
  const d = desk.reportCancellation("NA721-2026-09-20", "a crew shortage");
  assert.equal(d.id, "evt_NA721-2026-09-20_cancelled");
  assert.equal(d.newDeparture, null);
  const preview = desk.preview(d.id, "K7Q2XA");
  assert.match(preview.task, /is cancelled because of a crew shortage\. It will not operate\./);
  assert.match(preview.task, /Offer exactly these two options:\n1\. Move to another flight:/);
  assert.doesNotMatch(preview.task, /Keep the delayed flight/);
  const schema = preview.resultSchema as { properties: { choice: { enum: string[] } } };
  assert.ok(!schema.properties.choice.enum.includes("keep_delayed_flight"));

  // K7Q2XA is scripted to keep; on a cancelled flight that has to go to a person.
  await desk.startCall(d.id, "K7Q2XA");
  const kept = await desk.refresh(`${d.id}:K7Q2XA`);
  assert.equal(kept.status, "needs_review");
  assert.throws(() => desk.resolve(kept.key, { kind: "keep" }, ""), /no flight to keep/);
  await desk.startCall(d.id, "T5W1LC");
  assert.equal((await desk.refresh(`${d.id}:T5W1LC`)).status, "applied");
  assert.throws(() => desk.reportDelay("NA721-2026-09-20", 60, "late crew"), /already has a reported cancellation/);
});

test("force majeure disruptions get their own id and task wording", () => {
  const desk = dryDesk();
  const d = desk.reportDelay("NA721-2026-09-20", 240, "volcanic ash", "force_majeure");
  assert.equal(d.id, "evt_NA721-2026-09-20_fm_240");
  assert.match(desk.preview(d.id, "K7Q2XA").task, /outside the airline's control \(force majeure\)/);
});

test("a call after Reset demo gets a new idempotency key, so CALL-E places it again", async () => {
  const gateway = new RecordingGateway({ kind: "started", callId: "call_1" });
  const desk = new Desk(loadCatalog(), gateway, { statePath: null, liveDemoPhone: "+6591234567", liveCallBudget: 5 });
  let d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  const first = await desk.startCall(d.id, "K7Q2XA", "4567");
  first.status = "applied"; // finished, so reset is allowed
  desk.reset();
  d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  await desk.startCall(d.id, "K7Q2XA", "4567");
  assert.equal(gateway.requests.length, 2);
  assert.notEqual(gateway.requests[0]?.idempotencyKey, gateway.requests[1]?.idempotencyKey);
});

test("a delay that becomes a cancellation replaces the delay without undoing finished changes", async () => {
  const desk = dryDesk();
  const delay = desk.reportDelay("NA721-2026-09-20", 240, "a late inbound aircraft");
  // keep, refund, rebook, asks for a person
  for (const pnr of ["K7Q2XA", "M3P8RD", "T5W1LC", "B9H4ZN"]) {
    await desk.startCall(delay.id, pnr);
    await desk.refresh(`${delay.id}:${pnr}`);
  }
  const cancel = desk.reportCancellation("NA721-2026-09-20", "the aircraft is out of service");
  assert.equal(cancel.supersedes, delay.id);

  const snap = desk.snapshot();
  const flight = snap.flights.find((f) => f.id === "NA721-2026-09-20");
  assert.equal(flight?.disruption?.id, cancel.id);
  const old = snap.disruptions.find((d) => d.id === delay.id);
  assert.equal(old?.supersededBy, cancel.id);
  const state = (pnr: string) => old?.bookings.find((b) => b.pnr === pnr)?.state?.status;
  assert.equal(state("K7Q2XA"), "ticketed", "kept passengers are back in the queue");
  assert.equal(state("M3P8RD"), "refunded");
  assert.equal(state("T5W1LC"), "rebooked");

  // The person-review item from the delay can no longer apply its old options.
  const review = `${delay.id}:B9H4ZN`;
  assert.throws(() => desk.resolve(review, { kind: "refund" }, ""), /out of date/);
  assert.equal(desk.resolve(review, null, "Superseded by cancellation").status, "resolved_by_human");

  // Calls now come from the cancellation, with no keep option; old calls are refused.
  await assert.rejects(desk.startCall(delay.id, "R2D6YU"), /was replaced by/);
  assert.doesNotMatch(desk.preview(cancel.id, "K7Q2XA").task, /Keep the delayed flight/);
  await desk.startCall(cancel.id, "K7Q2XA");
  assert.equal((await desk.refresh(`${cancel.id}:K7Q2XA`)).status, "needs_review", "keep is not an option on a cancelled flight");
  await assert.rejects(desk.startCall(cancel.id, "M3P8RD"), /already been handled/);
});

test("a call still in progress when the delay grows finishes into review", async () => {
  const gateway = new DryRunGateway(0);
  let now = Date.parse("2026-09-19T08:00:00+07:00");
  const desk = new Desk(loadCatalog(), gateway, { statePath: null, liveCallBudget: 0, now: () => now });
  const short = desk.reportDelay("NA721-2026-09-20", 90, "a late inbound aircraft");
  await desk.startCall(short.id, "T5W1LC");
  const longer = desk.reportDelay("NA721-2026-09-20", 300, "a late inbound aircraft");
  assert.equal(longer.supersedes, short.id);
  now += 5_000;
  const entry = await desk.refresh(`${short.id}:T5W1LC`);
  assert.equal(entry.status, "needs_review");
  assert.match(entry.decision?.kind === "review" ? entry.decision.reasons.join() : "", /replaced by evt_NA721-2026-09-20_300/);
});

test("a shorter delay or a reinstated flight never replaces a disruption automatically", () => {
  const desk = dryDesk();
  desk.reportDelay("NA721-2026-09-20", 240, "weather");
  assert.throws(() => desk.reportDelay("NA721-2026-09-20", 120, "weather"), /Only a longer delay or a cancellation/);
  desk.reportCancellation("NA721-2026-09-20", "weather");
  assert.throws(() => desk.reportDelay("NA721-2026-09-20", 360, "weather"), /already has a reported cancellation/);
});

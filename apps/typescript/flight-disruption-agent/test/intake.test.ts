import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunGateway } from "../src/calle.ts";
import { findBooking, loadCatalog } from "../src/data.ts";
import { buildIntakeResultSchema, buildIntakeTask, decideIntake } from "../src/intake.ts";
import { voluntaryQuoteFor } from "../src/rules.ts";
import type { CallOutcome, ChangeRequest } from "../src/types.ts";

const catalog = loadCatalog();
const booking = findBooking(catalog, "T5W1LC"); // basic fare: every move costs money, refund is 0
const quote = voluntaryQuoteFor(catalog, booking);

function request(kind: ChangeRequest["kind"], targetFlightId: string | null = null): ChangeRequest {
  return { id: "req_T5W1LC_1", pnr: booking.pnr, kind, targetFlightId, channel: "chat", createdAt: "2026-09-19T02:00:00Z" };
}

function outcome(structured: Record<string, unknown>, extra: Partial<CallOutcome> = {}): CallOutcome {
  return {
    state: "completed",
    providerStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.9, label: "high" },
    result: null,
    structured: { selected_flight: "none", fee_accepted: "not_applicable", human_requested: "no", reason: "", ...structured },
    summary: null,
    transcript: [],
    failureCode: null,
    failureMessage: null,
    ...extra,
  };
}

test("the intake task discloses the AI, offers every priced option, and says the airline confirms", () => {
  const task = buildIntakeTask(catalog, booking, request("change"), quote);
  assert.match(task, /You are an AI assistant calling on behalf of TripKita/);
  for (const m of quote.moves) assert.ok(task.includes(m.label), m.label);
  assert.match(task, /no refund \(0 rupiah\)/);
  assert.match(task, /Keep the current booking with no change/);
  assert.match(task, /final only once the airline confirms it/);
  assert.match(task, /Never ask for or accept card numbers/);
  const schema = buildIntakeResultSchema(quote) as { properties: { choice: { enum: string[] }; selected_flight: { enum: string[] } } };
  assert.ok(schema.properties.choice.enum.includes("no_change"));
  assert.deepEqual(schema.properties.selected_flight.enum, [...quote.moves.map((m) => m.flightId), "none"]);
});

test("a consented move or refund is confirmed; keeping the booking is no change", () => {
  const move = quote.moves[0];
  assert.ok(move && move.total > 0);
  assert.deepEqual(decideIntake(outcome({ choice: "move_to_other_flight", selected_flight: move.flightId, fee_accepted: "yes" }), quote), {
    kind: "confirmed",
    action: { kind: "move", optionId: move.id },
    amount: move.total,
    reason: "",
  });
  assert.equal(decideIntake(outcome({ choice: "no_change" }), quote).kind, "no_change");
});

test("anything short of explicit consent and completion goes to a person", () => {
  const move = quote.moves[0];
  assert.ok(move);
  const cases: CallOutcome[] = [
    outcome({ choice: "move_to_other_flight", selected_flight: move.flightId, fee_accepted: "unknown" }),
    outcome({ choice: "move_to_other_flight", selected_flight: "NOT-OFFERED", fee_accepted: "yes" }),
    outcome({ choice: "refund", fee_accepted: "not_applicable" }, {}), // refund of 0 is reduced: needs a yes
    outcome({ choice: "no_change", human_requested: "unknown" }),
    outcome({ choice: "no_change" }, { taskCompleted: null }),
    outcome({ choice: "no_change" }, { confidence: { score: 0.4, label: "low" } }),
    outcome({ choice: "undecided" }),
    outcome({}, { state: "failed", structured: null, failureCode: "no_answer" }),
  ];
  for (const c of cases) assert.equal(decideIntake(c, quote).kind, "review", JSON.stringify(c.structured));
});

test("the dry-run intake call plays out the passenger's request and passes the decision rules", async () => {
  const gateway = new DryRunGateway(0);
  const target = quote.moves[1];
  assert.ok(target);
  const r = request("reschedule", target.flightId);
  const started = await gateway.start({
    task: "",
    phone: booking.phone,
    region: "US",
    locale: "en-US",
    resultSchema: {},
    metadata: {},
    idempotencyKey: "k",
    simulation: { kind: "request_intake", booking, quote, request: r },
  });
  assert.equal(started.kind, "started");
  const result = await gateway.get(started.kind === "started" ? started.callId : "");
  const decision = decideIntake(result, quote);
  assert.deepEqual(decision.kind === "confirmed" ? decision.action : null, { kind: "move", optionId: target.id });
});

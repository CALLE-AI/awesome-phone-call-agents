import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAccess, isLoopbackBind } from "../src/access.ts";
import type { CallGateway, StartResult } from "../src/calle.ts";
import { DryRunGateway } from "../src/calle.ts";
import { demoClockFromEnv } from "../src/config.ts";
import { loadCatalog } from "../src/data.ts";
import { decide } from "../src/decide.ts";
import { Desk } from "../src/desk.ts";
import { redactOutcome, redactText } from "../src/redact.ts";
import type { CallOutcome, Quote } from "../src/types.ts";

test("phone numbers in provider text are masked; amounts, times, and dates are not", () => {
  assert.equal(redactText("Call me on +65 9123 4567 please"), "Call me on ••• 4567 please");
  assert.equal(redactText("my number is 0812-3456-7890"), "my number is ••• 7890");
  assert.equal(redactText("refund of 1,605,000 rupiah at 19:45 on 2026-09-20"), "refund of 1,605,000 rupiah at 19:45 on 2026-09-20");
  assert.equal(redactText(null), null);
  assert.equal(redactText("moved to NA729-2026-09-20"), "moved to NA729-2026-09-20");
});

test("outcomes are masked everywhere except the booking identifiers the desk applies", () => {
  const outcome: CallOutcome = {
    state: "completed",
    providerStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.9, label: "high" },
    result: { choice: "refund", selected_flight: "none", fee_accepted: "yes", human_requested: "no", reason: "Call my wife at +6591234567" },
    structured: { new_ticket_number: "0002419000101", new_booking_code: "QA1B2Z", reason: "Reach us on +6566667777" },
    summary: "Passenger gave +6591234567",
    transcript: [{ speaker: "user", text: "It's 9123 4567" }],
    failureCode: null,
    failureMessage: "Could not reach +6591234567",
    hint: "mentions 91234567",
  };
  const r = redactOutcome(outcome);
  const text = JSON.stringify({ ...r, structured: { ...r.structured, new_ticket_number: "" } });
  assert.doesNotMatch(text, /91234567|9123 4567|66667777/);
  assert.equal(r.structured?.new_ticket_number, "0002419000101");
  assert.equal(r.structured?.new_booking_code, "QA1B2Z");
});

test("provider errors from a failed submission are stored masked", async () => {
  const gateway: CallGateway = {
    mode: "sdk",
    live: true,
    firstPollSeconds: 60,
    pollSeconds: 10,
    async start(): Promise<StartResult> {
      return { kind: "rejected", message: "invalid_request: +6591234567 is blocked" };
    },
    async get(): Promise<CallOutcome> {
      throw new Error("not polled");
    },
  };
  const desk = new Desk(loadCatalog(), gateway, { statePath: null, liveDemoPhone: "+6591234567", liveCallBudget: 3 });
  const d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  const entry = await desk.startCall(d.id, "K7Q2XA", "4567");
  assert.equal(entry.error, "invalid_request: ••• 4567 is blocked");
});

const quote: Quote = {
  pnr: "T",
  changeCase: "involuntary",
  thresholdMinutes: 120,
  keep: { newDeparture: "2026-09-20T05:10:00.000Z", total: 0 },
  moves: [],
  refund: { gross: 100, lines: [], amount: 100 },
};

function keepOutcome(extra: Partial<CallOutcome>, human: "yes" | "no" | "unknown" = "no"): CallOutcome {
  return {
    state: "completed",
    providerStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.95, label: "high" },
    result: { choice: "keep_delayed_flight", selected_flight: "none", fee_accepted: "not_applicable", human_requested: human, reason: "" },
    structured: null,
    summary: null,
    transcript: [],
    failureCode: null,
    failureMessage: null,
    ...extra,
  };
}

test("automatic changes need an explicit completion and an explicit no to a person", () => {
  assert.equal(decide(keepOutcome({}), quote).kind, "apply");
  assert.equal(decide(keepOutcome({ taskCompleted: null }), quote).kind, "review");
  assert.equal(decide(keepOutcome({}, "unknown"), quote).kind, "review");
});

test("the dashboard admits only loopback clients addressing localhost, unless a token is set", () => {
  const local = { remoteAddress: "127.0.0.1", host: "127.0.0.1:4310", authorization: undefined };
  assert.equal(checkAccess(local, null).ok, true);
  assert.equal(checkAccess({ ...local, host: "localhost:4310" }, null).ok, true);
  assert.equal(checkAccess({ ...local, remoteAddress: "192.168.1.20" }, null).ok, false);
  assert.equal(checkAccess({ ...local, host: "rebind.attacker.example:4310" }, null).ok, false, "DNS rebinding");
  const basic = (pw: string) => `Basic ${Buffer.from(`ops:${pw}`).toString("base64")}`;
  assert.equal(checkAccess({ ...local, remoteAddress: "10.0.0.5", authorization: basic("s3cret") }, "s3cret").ok, true);
  assert.equal(checkAccess({ ...local, remoteAddress: "10.0.0.5", authorization: basic("wrong") }, "s3cret").ok, false);
  assert.equal(checkAccess(local, "s3cret").ok, false, "a token applies to loopback too");
  assert.equal(isLoopbackBind("0.0.0.0"), false);
  assert.equal(isLoopbackBind("127.0.0.1"), true);
});

test("the demo clock keeps passenger requests eligible after the fixtures' real dates pass", () => {
  const judgingDay = Date.parse("2026-10-01T10:00:00+07:00");
  const clock = demoClockFromEnv({}, Date.now());
  const desk = new Desk(loadCatalog(), new DryRunGateway(0), {
    statePath: null,
    liveCallBudget: 0,
    now: () => judgingDay,
    demoNow: clock.now,
  });
  assert.equal(desk.submitRequest("K7Q2XA", "reschedule", "NA729-2026-09-20", "chat").status, "awaiting_call");
  assert.equal(demoClockFromEnv({ DEMO_NOW: "real" }).label, null);
  assert.throws(() => demoClockFromEnv({ DEMO_NOW: "tomorrow" }), /DEMO_NOW/);
});

test("overlapping status checks apply a finished call once and leave it applied", async () => {
  const desk = new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0 });
  const d = desk.reportDelay("NA721-2026-09-20", 240, "weather");
  await desk.startCall(d.id, "K7Q2XA");
  const key = `${d.id}:K7Q2XA`;
  await Promise.all([desk.refresh(key), desk.refresh(key), desk.refreshAll()]);
  const entry = desk.snapshot().disruptions[0]?.bookings.find((b) => b.pnr === "K7Q2XA")?.entry;
  assert.equal(entry?.status, "applied");
  assert.equal(entry?.decision?.kind, "apply");
});

test("live mode needs the operator's consent statement for the demo phone", async () => {
  const { liveAttestationError } = await import("../src/config.ts");
  assert.equal(liveAttestationError(false, {}), null);
  assert.match(liveAttestationError(true, {}) ?? "", /LIVE_DEMO_PHONE_CONSENT=yes/);
  assert.equal(liveAttestationError(true, { LIVE_DEMO_PHONE_CONSENT: "yes" }), null);
});

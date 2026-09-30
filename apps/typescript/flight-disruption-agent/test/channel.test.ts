import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunGateway } from "../src/calle.ts";
import { ChannelMessageError, NOT_FOUND_REPLY, parseChannelMessage, passengerMatches } from "../src/channel.ts";
import { findBooking, loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";

const catalog = loadCatalog();
const DAY_BEFORE = Date.parse("2026-09-19T08:00:00+07:00");

function dryDesk() {
  return new Desk(catalog, new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now: () => DAY_BEFORE });
}

const submit = (over: Record<string, unknown> = {}) =>
  parseChannelMessage({
    id: "msg-1",
    type: "request.submitted",
    channel: "chat",
    conversation_id: "conv-1",
    pnr: "p3x9ga",
    last_name: "saputra",
    kind: "reschedule",
    target_flight_id: "NA729-2026-09-20",
    ...over,
  });

test("a chat request with the right last name is told CALL-E will call to agree the change", () => {
  const desk = dryDesk();
  const { record } = desk.receiveChannelMessage(submit());
  assert.equal(record.outcome, "accepted");
  assert.equal(record.requestId, "req_P3X9GA_1");
  assert.match(record.reply, /TripKita's AI assistant will call you shortly/);
  assert.match(record.reply, /Nothing changes until you agree on that call/);
  assert.doesNotMatch(record.reply, /evt_|req_/, "no internal ids in passenger replies");
  const snap = desk.snapshot();
  assert.equal(snap.requests[0]?.status, "awaiting_call");
  assert.deepEqual(snap.requests[0]?.request.conversation, { channel: "chat", id: "conv-1" });
});

test("a wrong name and an unknown booking get the same reply, and nothing is created", () => {
  const desk = dryDesk();
  const wrongName = desk.receiveChannelMessage(submit({ id: "msg-2", last_name: "Tan" })).record;
  const unknown = desk.receiveChannelMessage(submit({ id: "msg-3", pnr: "ZZZZZZ" })).record;
  assert.equal(wrongName.reply, NOT_FOUND_REPLY);
  assert.equal(unknown.reply, NOT_FOUND_REPLY);
  assert.equal(desk.snapshot().requests.length, 0);
  assert.ok(passengerMatches(findBooking(catalog, "C5V8EJ"), "  HALIM "));
});

test("an open request needs no kind; the passenger picks on the call", () => {
  const desk = dryDesk();
  const { record } = desk.receiveChannelMessage(submit({ kind: undefined, target_flight_id: undefined }));
  assert.equal(record.outcome, "accepted");
  assert.equal(desk.snapshot().requests[0]?.request.kind, "change");
});

test("malformed channel messages are refused", () => {
  assert.throws(() => parseChannelMessage({ id: "x", type: "request.submitted", channel: "email", conversation_id: "c" }), /channel/);
  assert.throws(() => submit({ pnr: "ABC" }), /6-character/);
  assert.throws(() => submit({ kind: "upgrade" }), /kind/);
  assert.throws(() => submit({ last_name: "" }), /last_name/);
  assert.throws(() => parseChannelMessage({ id: "x", type: "request.confirmed", channel: "chat", conversation_id: "c", request_id: "r", confirmed_amount: 1 }), ChannelMessageError, "consent is taken on the call, not typed");
  assert.throws(() => parseChannelMessage({ id: "x", type: "hello", channel: "chat", conversation_id: "c" }), /type/);
});

test("later changes are pushed to the passenger's conversation, once per status", async () => {
  const sent: { status: string; reply: string; conversation_id: string }[] = [];
  const desk = new Desk(catalog, new DryRunGateway(0), {
    statePath: null,
    liveCallBudget: 0,
    now: () => DAY_BEFORE,
    channelNotifier: async (p) => {
      sent.push({ status: p.status, reply: p.reply, conversation_id: p.conversation_id });
    },
  });
  desk.receiveChannelMessage(submit({ pnr: "L6F2KM", last_name: "Kusuma" }));
  await desk.callPassengerForRequest("req_L6F2KM_1");
  await desk.refreshPassengerCall("req_L6F2KM_1");
  await desk.callAirlineDesk("req_L6F2KM_1");
  await desk.refreshRequest("req_L6F2KM_1");
  await desk.refreshRequest("req_L6F2KM_1");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((s) => [s.status, s.conversation_id]), [
    ["confirmed_on_call", "conv-1"],
    ["completed", "conv-1"],
  ]);
  assert.match(sent[0]?.reply ?? "", /arranging your move to NA 729 at 19:45 \(IDR 30,000\) with the airline/);
  assert.match(sent[1]?.reply ?? "", /^Done\. Rebooked to NA 729.*Reissued by the airline desk/);
  assert.equal(desk.snapshot().requests[0]?.channelUpdates?.[1]?.delivery, "sent");
});

test("a failed delivery is recorded without blocking the desk, and requests typed by the operator send nothing", async () => {
  const desk = new Desk(catalog, new DryRunGateway(0), {
    statePath: null,
    liveCallBudget: 0,
    now: () => DAY_BEFORE,
    channelNotifier: async () => {
      throw new Error("Channel returned HTTP 502.");
    },
  });
  desk.receiveChannelMessage(submit({ pnr: "C5V8EJ", last_name: "Halim" }));
  await desk.callPassengerForRequest("req_C5V8EJ_1");
  await desk.refreshPassengerCall("req_C5V8EJ_1");
  await desk.callAirlineDesk("req_C5V8EJ_1");
  const review = await desk.refreshRequest("req_C5V8EJ_1");
  assert.equal(review.status, "needs_review");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(
    review.channelUpdates?.map((u) => [u.status, u.delivery, u.error]),
    [
      ["confirmed_on_call", "failed", "Channel returned HTTP 502."],
      ["needs_review", "failed", "Channel returned HTTP 502."],
    ],
  );

  const typed = desk.submitRequest("L6F2KM", "reschedule", "NA729-2026-09-20", "phone");
  await desk.callPassengerForRequest(typed.request.id);
  const agreed = await desk.refreshPassengerCall(typed.request.id);
  assert.equal(agreed.status, "confirmed_on_call");
  assert.equal(agreed.channelUpdates, undefined);
});

test("channel updates only go over https, or plain http to this machine", async () => {
  const { channelNotifyUrlFromEnv } = await import("../src/config.ts");
  assert.equal(channelNotifyUrlFromEnv({}), null);
  assert.equal(channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "https://bot.example.test/updates" }), "https://bot.example.test/updates");
  assert.equal(channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "http://127.0.0.1:4330/updates" }), "http://127.0.0.1:4330/updates");
  assert.throws(() => channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "http://bot.example.test/updates" }), /must use https/);
  assert.throws(() => channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "nope" }), /not a valid URL/);
});

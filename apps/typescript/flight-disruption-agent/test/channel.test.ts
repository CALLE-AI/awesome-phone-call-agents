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

test("a chat request with the right last name is quoted back in passenger words", () => {
  const desk = dryDesk();
  const { record } = desk.receiveChannelMessage(submit());
  assert.equal(record.outcome, "accepted");
  assert.equal(record.requestId, "req_P3X9GA_1");
  assert.match(record.reply, /Moving booking P3X9GA to NA 729 at 19:45 costs IDR 415,000\./);
  assert.match(record.reply, /- Nusantara Air: Change fee IDR 350,000/);
  assert.match(record.reply, /reply YES 415000/);
  assert.doesNotMatch(record.reply, /evt_|req_/, "no internal ids in passenger replies");
  const snap = desk.snapshot();
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

test("the passenger confirms in the same conversation; the amount must match and retries change nothing", () => {
  const desk = dryDesk();
  desk.receiveChannelMessage(submit({ pnr: "L6F2KM", last_name: "Kusuma" }));
  const confirm = (over: Record<string, unknown>) =>
    parseChannelMessage({ id: "msg-c1", type: "request.confirmed", channel: "chat", conversation_id: "conv-1", request_id: "req_L6F2KM_1", confirmed_amount: 30000, ...over });

  const otherConversation = desk.receiveChannelMessage(confirm({ id: "msg-c0", conversation_id: "conv-evil" })).record;
  assert.equal(otherConversation.outcome, "refused");
  assert.equal(otherConversation.requestId, null, "another conversation does not learn the request exists");
  const wrongAmount = desk.receiveChannelMessage(confirm({ id: "msg-c2", confirmed_amount: 0 })).record;
  assert.match(wrongAmount.reply, /does not match the quote/);

  const ok = desk.receiveChannelMessage(confirm({}));
  assert.equal(ok.record.outcome, "accepted");
  assert.match(ok.record.reply, /^Done\. Rebooked to NA 729/);
  const retry = desk.receiveChannelMessage(confirm({}));
  assert.equal(retry.duplicate, true);
  const entry = desk.snapshot().requests[0];
  assert.deepEqual(entry?.confirmedBy, { kind: "passenger", channel: "chat", messageId: "msg-c1" });
  assert.equal(entry?.status, "completed");
});

test("a portal rejection tells the passenger the airline is being contacted; a decline changes nothing", () => {
  const desk = dryDesk();
  desk.receiveChannelMessage(submit());
  const confirmed = desk.receiveChannelMessage(
    parseChannelMessage({ id: "msg-c", type: "request.confirmed", channel: "chat", conversation_id: "conv-1", request_id: "req_P3X9GA_1", confirmed_amount: "IDR 415,000" }),
  ).record;
  assert.match(confirmed.reply, /We are contacting the airline/);

  desk.receiveChannelMessage(submit({ id: "msg-w", channel: "web_form", conversation_id: "form-9", pnr: "L6F2KM", last_name: "Kusuma", kind: "refund", target_flight_id: "" }));
  const declined = desk.receiveChannelMessage(
    parseChannelMessage({ id: "msg-d", type: "request.declined", channel: "web_form", conversation_id: "form-9", request_id: "req_L6F2KM_1" }),
  ).record;
  assert.match(declined.reply, /nothing changed/);
  assert.equal(desk.snapshot().bookings.find((b) => b.pnr === "L6F2KM")?.state?.status, "ticketed");
});

test("malformed channel messages are refused", () => {
  assert.throws(() => parseChannelMessage({ id: "x", type: "request.submitted", channel: "email", conversation_id: "c" }), /channel/);
  assert.throws(() => submit({ pnr: "ABC" }), /6-character/);
  assert.throws(() => submit({ kind: "upgrade" }), /kind/);
  assert.throws(() => submit({ last_name: "" }), /last_name/);
  assert.throws(() => parseChannelMessage({ id: "x", type: "request.confirmed", channel: "chat", conversation_id: "c", request_id: "r", confirmed_amount: "yes" }), ChannelMessageError);
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
  desk.receiveChannelMessage(submit());
  desk.receiveChannelMessage(
    parseChannelMessage({ id: "msg-c", type: "request.confirmed", channel: "chat", conversation_id: "conv-1", request_id: "req_P3X9GA_1", confirmed_amount: 415000 }),
  );
  assert.equal(sent.length, 0, "the passenger already got the portal result as the reply");

  await desk.callAirlineDesk("req_P3X9GA_1");
  await desk.refreshRequest("req_P3X9GA_1");
  await desk.refreshRequest("req_P3X9GA_1");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((s) => [s.status, s.conversation_id]), [["completed", "conv-1"]]);
  assert.match(sent[0]?.reply ?? "", /^Done\. Rebooked to NA 729.*Reissued by the airline desk/);
  assert.equal(desk.snapshot().requests[0]?.channelUpdates?.[0]?.delivery, "sent");

  // An operator confirming a channel request is also reported to the conversation.
  desk.receiveChannelMessage(submit({ id: "msg-2", pnr: "L6F2KM", last_name: "Kusuma", conversation_id: "conv-2" }));
  desk.confirmRequest("req_L6F2KM_1", 30_000);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((s) => s.status), ["completed", "completed"]);
  assert.equal(sent[1]?.conversation_id, "conv-2");
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
  desk.receiveChannelMessage(
    parseChannelMessage({ id: "msg-c", type: "request.confirmed", channel: "chat", conversation_id: "conv-1", request_id: "req_C5V8EJ_1", confirmed_amount: 580000 }),
  );
  await desk.callAirlineDesk("req_C5V8EJ_1");
  const review = await desk.refreshRequest("req_C5V8EJ_1");
  assert.equal(review.status, "needs_review");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(
    review.channelUpdates?.map((u) => [u.status, u.delivery, u.error]),
    [["needs_review", "failed", "Channel returned HTTP 502."]],
  );

  const typed = desk.submitRequest("L6F2KM", "reschedule", "NA729-2026-09-20", "phone");
  const done = desk.confirmRequest(typed.request.id, 30_000);
  assert.equal(done.channelUpdates, undefined);
});

test("channel updates only go over https, or plain http to this machine", async () => {
  const { channelNotifyUrlFromEnv } = await import("../src/config.ts");
  assert.equal(channelNotifyUrlFromEnv({}), null);
  assert.equal(channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "https://bot.example.test/updates" }), "https://bot.example.test/updates");
  assert.equal(channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "http://127.0.0.1:4330/updates" }), "http://127.0.0.1:4330/updates");
  assert.throws(() => channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "http://bot.example.test/updates" }), /must use https/);
  assert.throws(() => channelNotifyUrlFromEnv({ CHANNEL_NOTIFY_URL: "nope" }), /not a valid URL/);
});

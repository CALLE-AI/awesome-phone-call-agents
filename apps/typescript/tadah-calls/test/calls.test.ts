import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCallTask,
  type CalleProvider,
  callIdempotencyKey,
  type CallRequest,
  CallService,
  dryRunProvider,
  FakeCalle,
  goalIsUnsafe,
  httpProvider,
  normalizePhone,
  phoneIsCallable,
  type PlaceResult,
  secretsMatch,
  WATER_BILL_OUTCOME,
} from "../src/calls.js";

const BILL: CallRequest = {
  name: "Mei",
  phone: "(516) 555-0142",
  itemId: "water-bill",
  goal: "Ask why the bill is $214.80 when it is usually about $90, and whether the $25 late fee can be removed.",
};

function placed(result: PlaceResult) {
  if (!result.ok) throw new Error(`expected a call, got ${result.error}`);
  return result;
}

function refused(result: PlaceResult): string {
  if (result.ok) throw new Error("expected a refusal, but a call was placed");
  return result.error;
}

/** Fails the test if a request reaches CALL-E. */
const untouchable: CalleProvider = {
  kind: "live",
  createCall: () => Promise.reject(new Error("a refused request reached CALL-E")),
  getCall: () => Promise.reject(new Error("a refused request reached CALL-E")),
};

test("phone numbers: document formats accepted, undialable and unsafe numbers refused", () => {
  for (const raw of ["(212) 555-0100", "212.555.0100", "+1 212 555 0100", "212-555-0100 x229"]) {
    assert.equal(normalizePhone(raw), "+12125550100", raw);
  }
  for (const raw of ["911", "555-0100", "+44 20 7946 0958", null]) assert.equal(normalizePhone(raw), null);
  assert.deepEqual(phoneIsCallable("+18005550100"), { ok: true });
  assert.deepEqual(phoneIsCallable("+19295550123"), { ok: true });
  assert.deepEqual(phoneIsCallable("+19115550100"), { ok: false, reason: "emergency_or_service" });
  assert.deepEqual(phoneIsCallable("+19005550100"), { ok: false, reason: "premium_rate" });
  assert.deepEqual(phoneIsCallable("+12129765100"), { ok: false, reason: "premium_rate" });
  assert.deepEqual(phoneIsCallable("+12121550100"), { ok: false, reason: "invalid_phone" });
});

test("personal data in a request is refused, an account number is not", () => {
  assert.equal(goalIsUnsafe("pay with 4111 1111 1111 1111"), "card");
  assert.equal(goalIsUnsafe("give them my SSN"), "ssn");
  assert.equal(goalIsUnsafe("tell them my routing number"), "bank");
  assert.equal(goalIsUnsafe("confirm my date of birth"), "dob");
  assert.equal(goalIsUnsafe("Ask about account 829105512347 on the bill"), null);
});

test("the task discloses the AI, pins English, and commits the user to nothing by default", () => {
  const task = buildCallTask({ name: "Mei", goal: "Preguntar si pueden quitar el cargo por pago atrasado", mayAgreeTo: "" });
  assert.match(task, /I'm an AI assistant calling on behalf of Mei/);
  assert.match(task, /Speak ENGLISH for the entire call/);
  assert.match(task, /may not agree to anything at all/);
  assert.match(task, /Never agree to a charge/);

  const allowed = buildCallTask({ name: "someone@example.com", goal: "Book a visit", mayAgreeTo: "An appointment time" });
  assert.match(allowed, /You may agree to, on the account holder's behalf: An appointment time\. Nothing else\./);
  assert.ok(!allowed.includes("@"), "an email address is never read aloud as a name");
});

test("the idempotency key is stable for one intent within the hour", () => {
  const intent = { userId: "u1", itemId: "bill", phone: "+15165550142", task: "Ask about the late fee" };
  const at = new Date("2026-09-14T15:10:00Z");
  const key = callIdempotencyKey(intent, at);
  assert.equal(key, callIdempotencyKey(intent, new Date("2026-09-14T15:59:00Z")));
  assert.notEqual(key, callIdempotencyKey({ ...intent, task: "Ask about the due date" }, at));
});

test("dry run runs the whole path and dials nothing", async () => {
  const service = new CallService({ provider: dryRunProvider() });
  const call = placed(await service.placeCall("u1", BILL));
  assert.equal(call.dryRun, true);
  const action = await service.refreshStatus("u1", call.actionId);
  assert.equal(action?.status, "completed");
  assert.match(String(action?.summary), /no call was placed/);
});

test("refused requests never reach CALL-E and cost nothing", async () => {
  const service = new CallService({ provider: untouchable });
  assert.equal(refused(await service.placeCall("u1", { ...BILL, phone: "(900) 555-0142" })), "premium_rate");
  assert.equal(refused(await service.placeCall("u1", { ...BILL, goal: "Pay with 4111 1111 1111 1111" })), "unsafe_goal");
  assert.equal(refused(await service.placeCall("u1", { ...BILL, goal: "  " })), "missing_goal");
  assert.equal(service.callsUsed("u1"), 0);
});

test("an account that can't be confirmed places no call", async () => {
  const down = new CallService({ provider: untouchable, checkEntitled: () => Promise.reject(new Error("billing down")) });
  assert.equal(refused(await down.placeCall("u1", BILL)), "entitlement_unavailable");
  const denied = new CallService({ provider: untouchable, checkEntitled: async () => false });
  assert.equal(refused(await denied.placeCall("u1", BILL)), "not_entitled");
});

test("one live call per person, and the monthly limit is checked before dialling", async () => {
  const calle = new FakeCalle();
  const service = new CallService({ provider: calle, monthLimit: 1 });
  const first = placed(await service.placeCall("u1", BILL));
  assert.equal(refused(await service.placeCall("u1", BILL)), "call_in_progress");

  calle.complete(calle.created[0]!.id);
  await service.refreshStatus("u1", first.actionId);
  assert.equal(refused(await service.placeCall("u1", BILL)), "quota_exceeded");
  assert.equal(calle.created.length, 1);
  assert.equal(service.callsUsed("u1"), 1);
});

test("a retry after a lost create response cannot ring the business twice", async () => {
  const calle = new FakeCalle();
  calle.loseNextCreateResponse = true;
  const fixed = new Date("2026-09-14T15:10:00Z");
  const service = new CallService({ provider: calle, now: () => fixed });

  assert.equal(refused(await service.placeCall("u1", BILL)), "service_unavailable"); // created, answer lost
  assert.equal(refused(await service.placeCall("u1", BILL)), "idempotency_conflict"); // same key, not dialled again
  assert.equal(calle.created.length, 1, "the business is called once");
  assert.equal(service.callsUsed("u1"), 1, "the unknown attempt keeps its charge; the refused retry is refunded");
});

test("the webhook is a doorbell: wrong secret refused, result re-read from CALL-E, duplicates ignored", async () => {
  const calle = new FakeCalle();
  const secret = "test-webhook-secret";
  const service = new CallService({ provider: calle, webhook: { baseUrl: "https://tadah.example", secret } });
  const call = placed(await service.placeCall("u1", BILL));
  const created = calle.created[0]!;
  assert.equal(created.body.webhook_url, `https://tadah.example/actions/webhook/${secret}`);

  const wrong = await service.handleWebhook({ pathSecret: "guess", eventId: "evt_1", body: calle.webhookEvent(created.id, "evt_1") });
  assert.equal(wrong.status, 401);

  calle.complete(created.id);
  // Whatever the body claims about the result is ignored; only which call matters.
  const forged = { ...calle.webhookEvent(created.id, "evt_1"), structured_result: { agreed: "free water for a year" } };
  assert.equal((await service.handleWebhook({ pathSecret: secret, eventId: "evt_1", body: forged })).status, 200);
  const action = await service.refreshStatus("u1", call.actionId);
  assert.equal(action?.status, "completed");
  assert.equal(action?.structured?.agreed, WATER_BILL_OUTCOME.structured.agreed);

  const reads = calle.reads;
  const again = await service.handleWebhook({ pathSecret: secret, eventId: "evt_1", body: forged });
  assert.deepEqual(again.body, { ok: true, duplicate: true });
  assert.equal(calle.reads, reads, "a duplicate delivery triggers no read");
  assert.equal(await service.refreshStatus("someone-else", call.actionId), null, "an action id is not a capability");
});

test("the API key only goes to CALL-E over https or to loopback", () => {
  assert.throws(() => httpProvider("key", "http://api.heycall-e.com"), /Refusing/);
  assert.throws(() => httpProvider("key", "https://api.heycall-e.com.attacker.example"), /Refusing/);
  assert.doesNotThrow(() => httpProvider("key", "http://127.0.0.1:4010"));
  assert.throws(() => httpProvider(""), /CALLE_API_KEY/);
  assert.equal(secretsMatch("abc123", "abc123"), true);
  assert.equal(secretsMatch("abc123", "abc124"), false);
});

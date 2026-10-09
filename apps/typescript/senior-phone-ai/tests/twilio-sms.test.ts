import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createSmsAdapter, readTwilioSmsConfig, TwilioSmsAdapter } from "../lib/tools/twilio-sms";
import { createTwilioStatusHandler } from "../lib/tools/twilio-status-handler";
import { InMemorySmsStore } from "../lib/tools/sms-store";
import { SmsService, createSmsActionRequest } from "../lib/tools/sms-service";
import { InMemoryActionAuthorizationStore } from "../lib/safety/authorization";
import { PostCallFinalizer, InMemoryPostCallStore } from "../lib/post-call/finalizer";
import { parseCalleCallSnapshot } from "../lib/calle/status";

// Synthetic fixtures only. Injected fetchers never contact a provider.
const env = {
  SENIOR_PHONE_AI_MODE: "live", SMS_ENABLED: "true",
  SMS_ACCOUNT_ID: `AC${"0".repeat(32)}`, SMS_AUTH_TOKEN: "1".repeat(32),
  SMS_FROM_NUMBER: "+61491570156", SMS_TEST_RECIPIENTS: "+61491570157",
  SMS_STATUS_CALLBACK_URL: "https://example.com/api/twilio/sms/status",
};
const config = readTwilioSmsConfig(env);
const sid = `SM${"2".repeat(32)}`;
const request = { destinationE164: env.SMS_TEST_RECIPIENTS, message: "Requested library details: https://example.com/library", idempotencyKey: "sms:test:one" };

test("preview and disabled live SMS never contact Twilio; Australian configuration fails closed", async () => {
  const forbidden: typeof fetch = async () => { throw new Error("network must not run"); };
  assert.deepEqual(await createSmsAdapter({}, forbidden).send(request), { status: "previewed" });
  assert.deepEqual(await createSmsAdapter({ SENIOR_PHONE_AI_MODE: "live" }, forbidden).send(request), { status: "previewed" });
  for (const override of [{ SMS_TEST_RECIPIENTS: "+12025550123" }, { SMS_TEST_RECIPIENTS: "" }, { SMS_FROM_NUMBER: "Brand" }, { SMS_STATUS_CALLBACK_URL: "http://example.com/api/twilio/sms/status" }]) {
    assert.throws(() => readTwilioSmsConfig({ ...env, ...override }));
  }
});

test("Twilio sends exact authorized form content to fixed origin and preserves acceptance uncertainty", async () => {
  let attempts = 0;
  const adapter = new TwilioSmsAdapter(config, async (url, options) => {
    attempts++;
    assert.equal(String(url), `https://api.twilio.com/2010-04-01/Accounts/${config.accountId}/Messages.json`);
    assert.equal(options?.redirect, "error");
    const form = new URLSearchParams(String(options?.body));
    assert.equal(form.get("Body"), request.message);
    assert.equal(form.get("To"), request.destinationE164);
    assert.equal(form.get("StatusCallback"), config.statusUrl);
    return Response.json({ sid, status: "queued" }, { status: 201 });
  });
  assert.deepEqual(await adapter.send(request), { status: "queued", providerMessageId: sid });
  await assert.rejects(adapter.send({ ...request, destinationE164: "+61491570158" }), /not enabled/);
  assert.equal(attempts, 1);
  for (const status of [400, 401, 429, 500, 503, 408]) {
    const result = await new TwilioSmsAdapter(config, async () => new Response(null, { status })).send(request);
    assert.equal(result.status, status < 500 && status !== 408 ? "failed" : "unknown");
  }
  assert.equal((await new TwilioSmsAdapter(config, async () => { throw new Error("secret network details"); }).send(request)).status, "unknown");
  assert.equal((await new TwilioSmsAdapter(config, async () => Response.json({}, { status: 201 })).send(request)).status, "unknown");
});

function callback(status: string, options: { tamper?: boolean; account?: string; extra?: boolean } = {}) {
  const params = new URLSearchParams({ AccountSid: options.account ?? config.accountId, MessageSid: sid, MessageStatus: status });
  if (options.extra) params.set("FutureParameter", "supported");
  const payload = config.statusUrl + [...params.keys()].sort().map((key) => key + params.get(key)).join("");
  const signature = createHmac("sha1", config.authToken).update(payload).digest("base64");
  if (options.tamper) params.set("MessageStatus", "failed");
  return new Request(config.statusUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: params });
}

test("signed terminal callbacks reject forgery, preserve final status and retry a SID persistence race", async () => {
  const store = new InMemorySmsStore();
  const handler = createTwilioStatusHandler(() => config, () => store);
  assert.equal((await handler(callback("delivered", { tamper: true }))).status, 403);
  assert.equal((await handler(callback("delivered", { account: `AC${"3".repeat(32)}` }))).status, 403);
  assert.equal((await handler(callback("delivered"))).status, 503);
  const reservation = { ...request, authorizationId: "auth", correlationId: "11111111-1111-4111-8111-111111111111", seniorId: "senior", purpose: "Requested details" };
  store.reserve(reservation);
  store.updateDispatch(request.idempotencyKey, "queued", sid);
  assert.equal((await handler(callback("delivered", { extra: true }))).status, 204);
  assert.equal((await handler(callback("sent"))).status, 204);
  assert.equal((await handler(callback("delivered"))).status, 204);
  const record = store.reserve(reservation).record;
  assert.equal(record.status, "sent");
  assert.equal(record.processedEventIds.size, 1);
  assert.equal((await createTwilioStatusHandler(() => undefined, () => store)(callback("delivered"))).status, 404);
  assert.equal((await handler(new Request(config.statusUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "x".repeat(16385) }))).status, 413);
});

test("opted-in terminal call dispatches through Twilio once despite concurrent finalization", async () => {
  let sends = 0;
  const authorizations = new InMemoryActionAuthorizationStore();
  const store = new InMemorySmsStore();
  const service = new SmsService(new TwilioSmsAdapter(config, async () => {
    sends++;
    return Response.json({ sid }, { status: 201 });
  }), authorizations, store);
  const finalizer = new PostCallFinalizer(new InMemoryPostCallStore(), service);
  const record = await finalizer.finalize({ call: parseCalleCallSnapshot({ id: "call_test", status: "completed", task_completed: true, summary: "The library details were explained.", recipients: [] }), callSessionId: "session", seniorId: "senior", actions: [] });
  const sms = { ...request, authorizationId: "pending", principalId: "family", seniorId: "senior", correlationId: "11111111-1111-4111-8111-111111111111", purpose: "Requested follow-up", message: record.smsMessage };
  const pending = await authorizations.propose(createSmsActionRequest(sms));
  const authorized = { ...sms, authorizationId: pending.authorizationId };
  await authorizations.confirm(pending.authorizationId, sms.principalId, true);
  await assert.rejects(finalizer.sendOptedInFollowup(record, false, authorized));
  assert.equal(sends, 0);
  await Promise.all([finalizer.sendOptedInFollowup(record, true, authorized), finalizer.sendOptedInFollowup(record, true, authorized)]);
  assert.equal(sends, 1);
});


test("local demo omits callbacks and authenticates read-only message status lookups", async () => {
  const local = readTwilioSmsConfig({ ...env, SMS_STATUS_CALLBACK_URL: "" });
  let reads = 0;
  const adapter = new TwilioSmsAdapter(local, async (url, options) => {
    if (options?.method === "POST") {
      assert.equal(new URLSearchParams(String(options.body)).has("StatusCallback"), false);
      return Response.json({ sid }, { status: 201 });
    }
    reads++;
    assert.equal(options?.method, "GET");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Basic ${Buffer.from(`${env.SMS_ACCOUNT_ID}:${env.SMS_AUTH_TOKEN}`).toString("base64")}`);
    assert.equal(String(url), `https://api.twilio.com/2010-04-01/Accounts/${config.accountId}/Messages/${sid}.json`);
    return Response.json({ sid, account_sid: config.accountId, status: "delivered", error_code: null });
  });
  assert.equal((await adapter.send(request)).status, "queued");
  assert.equal((await adapter.readStatus(sid))?.status, "delivered");
  assert.equal(await adapter.readStatus("../bad"), undefined);
  assert.equal(reads, 1);
  assert.equal((await createTwilioStatusHandler(() => local, () => new InMemorySmsStore())(callback("delivered"))).status, 404);
  for (const data of [{ sid, account_sid: "wrong", status: "delivered" }, { sid: "wrong", account_sid: config.accountId, status: "delivered" }, { sid, account_sid: config.accountId, status: "unexpected" }]) {
    assert.equal(await new TwilioSmsAdapter(local, async () => Response.json(data)).readStatus(sid), undefined);
  }
  assert.equal(await new TwilioSmsAdapter(local, async () => new Response(null, { status: 503 })).readStatus(sid), undefined);
  assert.equal(await new TwilioSmsAdapter(local, async () => { throw new Error("private provider detail"); }).readStatus(sid), undefined);
});

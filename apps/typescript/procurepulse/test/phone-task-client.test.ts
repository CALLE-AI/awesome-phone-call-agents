import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeBaseUrl, CalleApiError, CalleClient, lifecycleStatus, transcript } from "../src/calle.ts";
import { FAKE_KEY, FakeCalle } from "../src/fake-calle.ts";
import { assertAllowlisted, countryCode, DestinationError, mask, parseAllowlist } from "../src/phone.ts";
import { holdCallBody, idempotencyKey, quoteCallBody, type QuoteRequest } from "../src/task.ts";

const request: QuoteRequest = {
  id: "r1", item: "Fresh basil", specification: "Genovese", quantity: "20 kg", deadline: "today at 7:00 PM",
  substitutes: true, buyerBusiness: "Harbor & Vine", buyerName: "Jordan Lee", timeZone: "America/Los_Angeles",
  vendors: [{ id: "rv", name: "Riverside Produce", phone: "+14155550142", region: "US-CA", authorizationNote: "Existing supplier" }],
};
const vendor = request.vendors[0]!;

describe("phone handling", () => {
  it("masks numbers and fails closed on an empty allowlist", () => {
    assert.equal(mask("+14155550142"), "+1••••••••42");
    assert.throws(() => assertAllowlisted("+14155550142", parseAllowlist("")), DestinationError);
    assert.equal(assertAllowlisted("+14155550142", parseAllowlist("+14155550142, +14155550178")), "+14155550142");
    assert.throws(() => parseAllowlist("4155550142"), /E.164/);
  });
  it("sends CALL-E a country code", () => {
    assert.equal(countryCode("US-CA"), "US");
    assert.equal(countryCode("gb"), "GB");
    assert.equal(countryCode(""), "US");
  });
});

describe("call bodies (OpenAPI 0.7.0)", () => {
  it("use recipients[{phones, locale, region}] and the per-recipient schema", () => {
    const body = quoteCallBody(request, vendor, null);
    assert.deepEqual(body.recipients, [{ phones: ["+14155550142"], locale: "en-US", region: "US" }]);
    assert.equal(body.recipient_result_schema.additionalProperties, false);
    assert.equal(body.metadata.purpose, "supplier_quote");
    assert.ok(!("webhook_url" in body));
    assert.equal(quoteCallBody(request, vendor, "https://pp.example.com/calle/webhook/t").webhook_url, "https://pp.example.com/calle/webhook/t");
  });
  it("disclose AI, forbid commitments, and never put the number in the task", () => {
    const { task } = quoteCallBody(request, vendor, null);
    assert.match(task, /AI assistant calling for Harbor & Vine/);
    assert.match(task, /Never place an order/);
    assert.ok(!task.includes("5550142"));
    assert.match(holdCallBody(request, vendor, null).task, /not an order, not a payment authorization/);
  });
  it("derive stable idempotency keys per vendor and purpose", () => {
    assert.equal(idempotencyKey("r1", "rv", "quote"), idempotencyKey("r1", "rv", "quote"));
    assert.notEqual(idempotencyKey("r1", "rv", "quote"), idempotencyKey("r1", "rv", "hold"));
  });
});

describe("CALL-E client", () => {
  it("only sends the key to the official origin or loopback", () => {
    assert.equal(assertSafeBaseUrl("https://api.heycall-e.com/"), "https://api.heycall-e.com");
    assert.equal(assertSafeBaseUrl("http://127.0.0.1:9999"), "http://127.0.0.1:9999");
    assert.throws(() => assertSafeBaseUrl("https://evil.example.com"), /Refusing/);
    assert.throws(() => assertSafeBaseUrl("http://api.heycall-e.com"), /Refusing/);
  });
  it("surfaces CALL-E's error envelope and pre-dial validation order", async () => {
    const fake = new FakeCalle();
    const client = new CalleClient(FAKE_KEY, await fake.start());
    try {
      const bad = { ...quoteCallBody(request, { ...vendor, phone: "+1555" }, null) };
      await assert.rejects(client.createCall(bad, "k1"), (e: CalleApiError) => e.status === 400 && e.code === "invalid_phone");
      await assert.rejects(
        client.createCall({ ...bad, extra: true } as never, "k2"),
        (e: CalleApiError) => e.status === 422 && e.code === "invalid_request",
      );
      await assert.rejects(new CalleClient("wrong", fake.baseUrl).checkKey(), (e: CalleApiError) => e.status === 401);
      assert.ok(await client.checkKey());
    } finally {
      await fake.stop();
    }
  });
  it("reads lifecycle and transcript from a snapshot", () => {
    const call = (status: string, attempt?: string) => ({ status, recipients: [{ attempts: attempt ? [{ status: attempt, transcript_turns: [{ speaker: "bot", text: "Hi" }, { speaker: "user", text: "Sam here" }] }] : [] }] });
    assert.equal(lifecycleStatus(call("queued")), "queued");
    assert.equal(lifecycleStatus(call("in_progress", "dialing")), "ringing");
    assert.equal(lifecycleStatus(call("in_progress", "in_progress")), "in_progress");
    assert.equal(lifecycleStatus(call("in_progress", "completed")), "finalizing");
    assert.deepEqual(transcript(call("completed", "completed")).map((t) => t.speaker), ["agent", "supplier"]);
  });
});

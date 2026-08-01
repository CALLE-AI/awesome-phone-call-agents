/**
 * End-to-end tests: real HTTP against the fake CALL-E and fake Shopify servers.
 *
 * These exercise the parts a unit test cannot: the polling loop, idempotency
 * replay, ambiguous creation, and what actually lands on the Shopify order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildFakeCalle } from "./fake-calle-server.mjs";
import { buildFakeShopify } from "./fake-shopify-server.mjs";
import { CalleClient, AmbiguousCallError } from "../src/calle.mjs";
import { ShopifyClient } from "../src/shopify.mjs";
import { createGate } from "../src/gate.mjs";
import { buildIdempotencyKey } from "../src/decision.mjs";

const SHOP = "demo-cod.myshopify.com";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function orderFixture(overrides = {}) {
  return {
    id: 5551234567890,
    gateway: "Cash on Delivery (COD)",
    payment_gateway_names: ["Cash on Delivery (COD)"],
    total_price: "1290000",
    currency: "VND",
    tags: "vip-customer",
    customer: { first_name: "Mai", phone: "+15005550100" },
    shipping_address: {
      address1: "128 Nguyen Trai",
      city: "Ha Noi",
      country: "Vietnam",
      phone: "+15005550100",
    },
    line_items: [{ title: "Wireless earbuds", quantity: 1 }],
    ...overrides,
  };
}

async function withStack(fn, { pollsBeforeTerminal = 1 } = {}) {
  const calleServer = buildFakeCalle({ pollsBeforeTerminal });
  const shopifyServer = buildFakeShopify();
  const callePort = await listen(calleServer);
  const shopifyPort = await listen(shopifyServer);

  // Point the Shopify client at the fake by overriding fetch's target origin.
  const shopify = new ShopifyClient({ shopDomain: SHOP, accessToken: "fake-token" });
  shopify.baseUrl = `http://127.0.0.1:${shopifyPort}/admin/api/2026-01`;

  const calle = new CalleClient({
    apiKey: "fake-key",
    baseUrl: `http://127.0.0.1:${callePort}`,
    sleep: () => Promise.resolve(), // no real waiting in tests
  });

  try {
    return await fn({ calle, shopify, shopifyServer });
  } finally {
    await close(calleServer);
    await close(shopifyServer);
  }
}

test("confirmed order is tagged cod-ship and the merchant tag survives", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const result = await gate.run({ order: orderFixture(), shopDomain: SHOP, merchantName: "Demo Store" });

    assert.equal(result.decision, "ship");
    assert.ok(result.callId, "a call id must be recorded for the audit trail");

    const write = shopifyServer.writes.at(-1);
    assert.equal(write.orderId, "5551234567890");
    assert.match(write.order.tags, /cod-ship/);
    assert.match(write.order.tags, /vip-customer/);
    assert.match(write.order.note, /SHIP \(confirmed\)/);
    assert.doesNotMatch(write.order.note, /\+15005550100/, "the note must not leak the phone number");
  });
});

test("address correction reaches the Shopify note", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const order = orderFixture({
      customer: { first_name: "Linh", phone: "+15005550101" },
      shipping_address: { address1: "42 Le Loi", city: "Da Nang", country: "Vietnam", phone: "+15005550101" },
    });
    const result = await gate.run({ order, shopDomain: SHOP, merchantName: "Demo Store" });

    assert.equal(result.decision, "ship");
    assert.equal(result.correctedAddress, "77 Tran Phu, Da Nang, Vietnam");
    const write = shopifyServer.writes.at(-1);
    assert.match(write.order.tags, /cod-address-corrected/);
    assert.match(write.order.note, /77 Tran Phu/);
  });
});

test("a null structured result holds the order instead of shipping it", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const order = orderFixture({
      customer: { first_name: "Ha", phone: "+15005550105" },
      shipping_address: { address1: "9 Hai Ba Trung", city: "Ha Noi", country: "Vietnam", phone: "+15005550105" },
    });
    const result = await gate.run({ order, shopDomain: SHOP, merchantName: "Demo Store" });

    assert.equal(result.decision, "hold");
    assert.equal(result.reason, "answered_no_structured_result");
    assert.match(shopifyServer.writes.at(-1).order.tags, /cod-hold/);
  });
});

test("no answer retries once with a fresh key, then holds", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const order = orderFixture({
      customer: { first_name: "Nam", phone: "+15005550106" },
      shipping_address: { address1: "3 Ba Trieu", city: "Ha Noi", country: "Vietnam", phone: "+15005550106" },
    });
    const result = await gate.run({ order, shopDomain: SHOP, merchantName: "Demo Store", maxAttempts: 2 });

    assert.equal(result.decision, "hold");
    assert.equal(result.reason, "not_reached:no_answer");
    assert.match(shopifyServer.writes.at(-1).order.tags, /cod-hold/);
  });
});

test("a 2xx create with no call id is reported ambiguous and never re-dialled", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const order = orderFixture({
      customer: { first_name: "Tu", phone: "+15005550107" },
      shipping_address: { address1: "1 Quang Trung", city: "Ha Noi", country: "Vietnam", phone: "+15005550107" },
    });
    const result = await gate.run({ order, shopDomain: SHOP, merchantName: "Demo Store" });

    assert.equal(result.decision, "hold");
    assert.equal(result.reason, "ambiguous_call_creation");
    assert.equal(result.callId, null);
    assert.match(shopifyServer.writes.at(-1).order.tags, /cod-hold/);
  });
});

test("replaying an idempotency key returns the same call, never a second one", async () => {
  await withStack(async ({ calle }) => {
    const key = buildIdempotencyKey({ shopDomain: SHOP, orderId: 999 });
    const first = await calle.createCall({
      phone: "+15005550100",
      task: "confirm",
      metadata: {},
      idempotencyKey: key,
    });
    const second = await calle.createCall({
      phone: "+15005550100",
      task: "confirm",
      metadata: {},
      idempotencyKey: key,
    });
    assert.equal(first.callId, second.callId, "a replay must not create a second phone call");
    assert.equal(second.raw.replayed, true);
  });
});

test("polling waits through non-terminal statuses before deciding", async () => {
  await withStack(
    async ({ calle }) => {
      const { callId } = await calle.createCall({
        phone: "+15005550100",
        task: "confirm",
        metadata: {},
        idempotencyKey: "poll-test",
      });
      const { call, timedOut } = await calle.waitForTerminal(callId, { intervalMs: 0 });
      assert.equal(timedOut, false);
      assert.equal(call.status, "completed");
    },
    { pollsBeforeTerminal: 3 },
  );
});

test("polling gives up rather than hanging forever", async () => {
  await withStack(
    async ({ calle }) => {
      const { callId } = await calle.createCall({
        phone: "+15005550100",
        task: "confirm",
        metadata: {},
        idempotencyKey: "timeout-test",
      });
      let clock = 0;
      const { timedOut } = await calle.waitForTerminal(callId, {
        intervalMs: 0,
        timeoutMs: 10,
        now: () => (clock += 20),
      });
      assert.equal(timedOut, true);
    },
    { pollsBeforeTerminal: 1000 },
  );
});

test("a prepaid order is skipped without placing a call", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const result = await gate.run({
      order: orderFixture({ gateway: "shopify_payments", payment_gateway_names: ["shopify_payments"] }),
      shopDomain: SHOP,
      merchantName: "Demo Store",
    });
    assert.equal(result.decision, "skip");
    assert.equal(shopifyServer.writes.length, 0, "a skipped order must not be written to");
  });
});

test("an order with no usable phone number holds without calling", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const order = orderFixture({
      customer: { first_name: "Mai", phone: "0342701517" },
      shipping_address: { address1: "128 Nguyen Trai", city: "Ha Noi", country: "Vietnam", phone: "0342701517" },
    });
    const result = await gate.run({ order, shopDomain: SHOP, merchantName: "Demo Store" });
    assert.equal(result.decision, "hold");
    assert.equal(result.reason, "no_usable_phone_number");
    assert.equal(result.callId, null);
    assert.match(shopifyServer.writes.at(-1).order.tags, /cod-hold/);
  });
});

test("dry run produces the script and key without touching either service", async () => {
  await withStack(async ({ calle, shopify, shopifyServer }) => {
    const gate = createGate({ calle, shopify });
    const result = await gate.run({
      order: orderFixture(),
      shopDomain: SHOP,
      merchantName: "Demo Store",
      dryRun: true,
    });
    assert.equal(result.decision, "preview");
    assert.equal(result.idempotencyKey, buildIdempotencyKey({ shopDomain: SHOP, orderId: 5551234567890 }));
    assert.doesNotMatch(result.phone, /5550100$/, "preview must mask the phone number");
    assert.match(result.task, /speaking to Mai/);
    assert.equal(shopifyServer.writes.length, 0);
  });
});

test("createCall rejects a non-E.164 number before any network call", async () => {
  const calle = new CalleClient({ apiKey: "k", baseUrl: "http://127.0.0.1:1", fetchImpl: () => { throw new Error("must not be called"); } });
  await assert.rejects(
    () => calle.createCall({ phone: "0342701517", task: "t", metadata: {}, idempotencyKey: "k1" }),
    /E\.164/,
  );
});

test("a network failure during create is ambiguous, not a silent success", async () => {
  const calle = new CalleClient({
    apiKey: "k",
    baseUrl: "http://127.0.0.1:1",
    fetchImpl: () => Promise.reject(new Error("ECONNRESET")),
  });
  await assert.rejects(
    () => calle.createCall({ phone: "+15005550100", task: "t", metadata: {}, idempotencyKey: "k2" }),
    (error) => error instanceof AmbiguousCallError && error.idempotencyKey === "k2",
  );
});

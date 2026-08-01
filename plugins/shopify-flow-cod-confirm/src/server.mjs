#!/usr/bin/env node
/**
 * HTTP receiver for Shopify Flow / orders-create webhooks.
 *
 * Shopify Flow's "Send HTTP request" action posts here; so does a raw
 * `orders/create` webhook. Both paths verify the HMAC before any phone call is
 * possible.
 *
 * The handler answers Shopify immediately (Shopify times out at 5s and retries,
 * and a retry that placed a second call would be unforgivable) and runs the
 * gate in the background keyed by a stable idempotency key.
 */

import { createServer } from "node:http";
import { CalleClient } from "./calle.mjs";
import { ShopifyClient, verifyShopifyHmac } from "./shopify.mjs";
import { createGate } from "./gate.mjs";
import { buildIdempotencyKey, maskDeep } from "./decision.mjs";

const PORT = Number(process.env.PORT || 8787);
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || "";
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN || "";
const MERCHANT_NAME = process.env.MERCHANT_NAME || "the store";

/** In-flight and completed runs, keyed by idempotency key. */
const runs = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export function buildServer({ calle, shopify, log = console.error } = {}) {
  const gate = createGate({ calle, shopify, log: (e) => log(`[cod-gate] ${JSON.stringify(e)}`) });

  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, service: "cod-gate", runs: runs.size });
    }

    if (req.method === "GET" && req.url?.startsWith("/runs/")) {
      const key = decodeURIComponent(req.url.slice("/runs/".length));
      const run = runs.get(key);
      if (!run) return json(res, 404, { error: "unknown run" });
      return json(res, 200, maskDeep({ key, state: run.state, result: run.result ?? null, error: run.error ?? null }));
    }

    if (req.method !== "POST" || req.url !== "/webhooks/orders-create") {
      return json(res, 404, { error: "not found" });
    }

    const rawBody = await readBody(req);
    const hmac = req.headers["x-shopify-hmac-sha256"];

    if (SHOPIFY_WEBHOOK_SECRET) {
      const ok = await verifyShopifyHmac({ rawBody, hmacHeader: hmac, secret: SHOPIFY_WEBHOOK_SECRET });
      if (!ok) return json(res, 401, { error: "invalid webhook signature" });
    } else {
      log("[cod-gate] WARNING: SHOPIFY_WEBHOOK_SECRET is unset, signature check skipped.");
    }

    let order;
    try {
      order = JSON.parse(rawBody);
    } catch {
      return json(res, 400, { error: "invalid json body" });
    }

    const shopDomain = String(req.headers["x-shopify-shop-domain"] || SHOP_DOMAIN || "");
    if (!order?.id || !shopDomain) {
      return json(res, 400, { error: "missing order id or shop domain" });
    }

    const key = buildIdempotencyKey({ shopDomain, orderId: order.id, attempt: 1 });

    // Shopify retries. A retry must observe the first run, never start a second.
    if (runs.has(key)) {
      const run = runs.get(key);
      return json(res, 200, { accepted: true, deduped: true, key, state: run.state });
    }

    const run = { state: "running", result: null, error: null };
    runs.set(key, run);

    // Answer first, work after: Shopify's 5s budget must never gate a phone call.
    json(res, 202, { accepted: true, key, poll: `/runs/${encodeURIComponent(key)}` });

    gate
      .run({ order, shopDomain, merchantName: MERCHANT_NAME })
      .then((result) => {
        run.state = "done";
        run.result = result;
      })
      .catch((error) => {
        run.state = "error";
        run.error = error.message;
        log(`[cod-gate] run failed: ${error.message}`);
      });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const apiKey = process.env.CALL_E_API_KEY;
  if (!apiKey) {
    console.error("CALL_E_API_KEY is required to run the server.");
    process.exit(2);
  }
  const calle = new CalleClient({ apiKey, baseUrl: process.env.CALL_E_BASE_URL || undefined });
  const shopify = process.env.SHOPIFY_ACCESS_TOKEN
    ? new ShopifyClient({ shopDomain: SHOP_DOMAIN, accessToken: process.env.SHOPIFY_ACCESS_TOKEN })
    : null;
  if (!shopify) console.error("[cod-gate] SHOPIFY_ACCESS_TOKEN unset: verdicts will not be written back.");

  buildServer({ calle, shopify }).listen(PORT, () => {
    console.error(`[cod-gate] listening on :${PORT}`);
  });
}

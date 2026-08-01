#!/usr/bin/env node
/**
 * Fake Shopify Admin API. Records every writeback so a test (or a demo) can
 * assert what the merchant would actually see on the order.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SHOPIFY_PORT || 8798);

export function buildFakeShopify({ orders = new Map() } = {}) {
  const writes = [];

  const server = createServer(async (req, res) => {
    const match = req.url?.match(/^\/admin\/api\/[^/]+\/orders\/([^/.]+)\.json$/);
    if (!match) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ errors: "not found" }));
    }
    if (!req.headers["x-shopify-access-token"]) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ errors: "missing token" }));
    }
    const orderId = match[1];

    if (req.method === "GET") {
      const order = orders.get(String(orderId));
      res.writeHead(order ? 200 : 404, { "content-type": "application/json" });
      return res.end(JSON.stringify(order ? { order } : { errors: "not found" }));
    }

    if (req.method === "PUT") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      writes.push({ orderId: String(orderId), order: body.order });
      const existing = orders.get(String(orderId)) || { id: orderId };
      const updated = { ...existing, ...body.order };
      orders.set(String(orderId), updated);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ order: updated }));
    }

    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: "method not allowed" }));
  });

  server.writes = writes;
  server.orders = orders;
  return server;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildFakeShopify().listen(PORT, () => {
    console.error(`[fake-shopify] listening on :${PORT}`);
  });
}

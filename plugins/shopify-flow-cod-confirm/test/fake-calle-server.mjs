#!/usr/bin/env node
/**
 * Fake CALL-E server.
 *
 * CONTRIBUTING.md requires every runnable contribution to have a fake-server or
 * no-call path. This one is also how the regression tests exercise the polling
 * loop without waiting on a real phone.
 *
 * Scenarios are selected by the recipient phone number so a single server can
 * drive every branch of the decision table:
 *
 *   +15005550100  answered, confirmed, address correct        -> ship
 *   +15005550101  answered, confirmed, address wrong + fix    -> ship
 *   +15005550102  answered, confirmed, address wrong, no fix  -> hold
 *   +15005550103  answered, not confirmed                     -> hold
 *   +15005550104  answered, cancel requested                  -> hold
 *   +15005550105  answered, structured_result null            -> hold
 *   +15005550106  no answer                                   -> retry then hold
 *   +15005550107  2xx create with no call id                  -> ambiguous
 */

import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_CALLE_PORT || 8799);

const SCENARIOS = {
  "+15005550100": { status: "completed", structured_result: { order_confirmed: true, address_correct: true, corrected_address: "", preferred_delivery_window: "tomorrow morning", cancel_requested: false } },
  "+15005550101": { status: "completed", structured_result: { order_confirmed: true, address_correct: false, corrected_address: "77 Tran Phu, Da Nang, Vietnam", preferred_delivery_window: "", cancel_requested: false } },
  "+15005550102": { status: "completed", structured_result: { order_confirmed: true, address_correct: false, corrected_address: "", preferred_delivery_window: "", cancel_requested: false } },
  "+15005550103": { status: "completed", structured_result: { order_confirmed: false, address_correct: true, corrected_address: "", preferred_delivery_window: "", cancel_requested: false } },
  "+15005550104": { status: "completed", structured_result: { order_confirmed: false, address_correct: true, corrected_address: "", preferred_delivery_window: "", cancel_requested: true } },
  "+15005550105": { status: "completed", structured_result: null },
  "+15005550106": { status: "no_answer", structured_result: null },
  "+15005550107": { noCallId: true },
};

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
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

export function buildFakeCalle({ pollsBeforeTerminal = 1 } = {}) {
  // Per-server state. Module-level state would leak replays between servers,
  // which is exactly the bug this fake exists to catch.
  const calls = new Map();
  /** Replayed idempotency keys must return the SAME call, never a new one. */
  const byIdempotencyKey = new Map();
  let counter = 0;

  return createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/v1/calls") {
      if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
        return json(res, 401, { error: { message: "missing bearer token" } });
      }
      const idempotencyKey = req.headers["idempotency-key"];
      if (!idempotencyKey) {
        return json(res, 400, { error: { message: "idempotency-key header is required" } });
      }
      if (byIdempotencyKey.has(idempotencyKey)) {
        return json(res, 200, { call_id: byIdempotencyKey.get(idempotencyKey), replayed: true });
      }

      const body = JSON.parse(await readBody(req));
      const phone = body?.recipients?.[0]?.phones?.[0];
      const scenario = SCENARIOS[phone];
      if (!scenario) return json(res, 400, { error: { message: `unknown fake scenario for ${phone}` } });

      if (scenario.noCallId) {
        // Deliberately ambiguous: accepted, but nothing usable came back.
        return json(res, 200, { accepted: true });
      }

      counter += 1;
      const callId = `call_fake_${counter}`;
      byIdempotencyKey.set(idempotencyKey, callId);
      calls.set(callId, { id: callId, status: "queued", polls: 0, scenario, metadata: body?.metadata ?? null });
      return json(res, 201, { call_id: callId, status: "queued" });
    }

    if (req.method === "GET" && req.url?.startsWith("/v1/calls/")) {
      const callId = decodeURIComponent(req.url.slice("/v1/calls/".length));
      const call = calls.get(callId);
      if (!call) return json(res, 404, { error: { message: "not_found" } });
      call.polls += 1;
      if (call.polls > pollsBeforeTerminal) {
        call.status = call.scenario.status;
        call.structured_result = call.scenario.structured_result;
      } else {
        call.status = "in_progress";
      }
      return json(res, 200, { id: call.id, status: call.status, structured_result: call.structured_result ?? null, metadata: call.metadata });
    }

    return json(res, 404, { error: { message: "not found" } });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildFakeCalle().listen(PORT, () => {
    console.error(`[fake-calle] listening on :${PORT}`);
    console.error("[fake-calle] point CALL_E_BASE_URL at this server to run the gate without placing a call.");
  });
}

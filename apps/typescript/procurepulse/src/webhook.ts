import http from "node:http";
import { TERMINAL, type CalleClient } from "./calle.ts";
import type { Ledger } from "./ledger.ts";
import { applySnapshot } from "./race.ts";

/**
 * CALL-E terminal webhooks are not signed, so a delivery is only a hint:
 *   1. it must arrive on an unguessable path token,
 *   2. the CALL-E-Event-Id header must match the body's top-level `id`,
 *   3. the event is claimed before any side effect (delivery is at-least-once),
 *   4. the call (`data.id`) is re-read with GET /v1/calls/{id}; only that snapshot is applied.
 */
const TERMINAL_EVENTS = ["call.completed", "call.failed", "call.canceled", "call.result_validation_failed"];

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  deps: { ledger: Ledger; client: CalleClient },
): Promise<WebhookResponse> {
  const header = headers["calle-event-id"];
  const eventId = Array.isArray(header) ? header[0] : header;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "Malformed JSON" } };
  }
  if (!event || typeof event !== "object" || !eventId || event.id !== eventId)
    return { status: 400, body: { error: "Missing or mismatched CALL-E-Event-Id" } };
  const type = typeof event.type === "string" ? event.type : "";
  const data = (event.data ?? {}) as Record<string, unknown>;
  const callId = typeof data.id === "string" ? data.id : "";
  if (!TERMINAL_EVENTS.includes(type)) return { status: 200, body: { ok: true, ignored: type } };
  if (!callId.startsWith("call_")) return { status: 400, body: { error: "Event data is missing a call id" } };

  const task = deps.ledger.taskByCallId(callId);
  if (!task) return { status: 404, body: { error: "Unknown CALL-E call" } };
  if (!deps.ledger.claimEvent(eventId, callId, type)) return { status: 200, body: { ok: true, duplicate: true } };
  try {
    const call = await deps.client.getCall(callId);
    if (!TERMINAL.includes(String(call.status))) {
      deps.ledger.releaseEvent(eventId);
      return { status: 409, body: { error: "Call is not terminal yet; retry later" } };
    }
    const status = applySnapshot(deps.ledger, task, call, "webhook");
    deps.ledger.markEventProcessed(eventId);
    return { status: 200, body: { ok: true, status } };
  } catch (error) {
    deps.ledger.releaseEvent(eventId);
    return { status: 502, body: { error: `Could not verify call: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

/** POST /calle/webhook/<token>. Anything else is 404, so the path token is the first gate. */
export function createWebhookServer(token: string, deps: { ledger: Ledger; client: CalleClient }): http.Server {
  if (token.length < 16) throw new Error("Use a webhook path token of at least 16 random characters");
  return http.createServer((req, res) => {
    const send = (r: WebhookResponse) => {
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    };
    if (req.method !== "POST" || req.url !== `/calle/webhook/${token}`) return send({ status: 404, body: { error: "Not found" } });
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      handleWebhook(req.headers, raw, deps).then(send, () => send({ status: 500, body: { error: "Webhook processing failed; retry is safe" } }));
    });
  });
}

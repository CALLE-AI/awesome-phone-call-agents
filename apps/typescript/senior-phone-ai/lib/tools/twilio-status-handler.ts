import { createHash } from "node:crypto";
import type { SmsDeliveryEvent } from "./contracts";
import { verifyTwilioForm, type TwilioSmsConfig } from "./twilio-sms";

export function createTwilioStatusHandler(
  configuration: () => TwilioSmsConfig | undefined,
  store: () => { applyDelivery(event: SmsDeliveryEvent): unknown | Promise<unknown> },
) {
  return async (request: Request): Promise<Response> => {
    let config: TwilioSmsConfig | undefined;
    try { config = configuration(); } catch { return new Response(null, { status: 503 }); }
    if (!config?.statusUrl) return new Response(null, { status: 404 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return new Response(null, { status: 415 });
    // Bound the stream, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(value);
      }
    } catch { return new Response(null, { status: 400 }); }
    let params: URLSearchParams;
    try { params = verifyTwilioForm(Buffer.concat(chunks).toString("utf8"), request.headers.get("x-twilio-signature") ?? "", config); }
    catch { return new Response(null, { status: 403 }); }
    const sid = params.get("MessageSid") ?? "";
    const status = params.get("MessageStatus");
    if (!/^SM[0-9a-f]{32}$/i.test(sid)) return new Response(null, { status: 400 });
    // Ignore intermediate 'sent' notifications: they can arrive after terminal ones.
    if (!["delivered", "undelivered", "failed"].includes(status ?? "")) return new Response(null, { status: 204 });
    try {
      const updated = await store().applyDelivery({
        eventId: createHash("sha256").update(`${sid}:${status}`).digest("hex"),
        providerMessageId: sid,
        occurredAt: new Date().toISOString(),
        status: status === "delivered" ? "sent" : "failed",
      });
      // A callback can race the API response that persists the SID. Ask for retry.
      return new Response(null, { status: updated ? 204 : 503 });
    } catch { return new Response(null, { status: 503 }); }
  };
}

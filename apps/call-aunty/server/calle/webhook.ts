import crypto from "node:crypto";

import { calleConfig } from "./config";

export function verifyWebhookSignature(body: string, signature?: string) {
  if (!calleConfig.webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", calleConfig.webhookSecret).update(body).digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parseWebhook(body: string, signature?: string) {
  if (!verifyWebhookSignature(body, signature)) {
    throw new Error("Invalid CALL-E webhook signature");
  }
  const payload: { data?: unknown; id?: string; status?: string } = JSON.parse(body);
  return (payload.data ?? payload) as { id?: string; status?: string; [key: string]: unknown };
}

export function handleCalleWebhook(req: { rawBody?: Buffer; body?: unknown; header: (name: string) => string | undefined }) {
  const body = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString("utf8")
    : Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});
  return parseWebhook(body, req.header("x-calle-signature") ?? undefined);
}

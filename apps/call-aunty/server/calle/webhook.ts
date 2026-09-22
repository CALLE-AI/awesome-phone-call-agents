import crypto from "node:crypto";

import { calleConfig } from "./config";
import { isKnownProviderStatus } from "./provider-contract";

const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECEIPTS = 5_000;
const receipts = new Map<string, number>();

type WebhookPayload = { data?: unknown; id?: unknown; status?: unknown; type?: unknown; event_id?: unknown };
export type CalleWebhookEvent = { id: string; status?: string; [key: string]: unknown };

function gcReceipts(now = Date.now()): void {
  for (const [key, receivedAt] of receipts) {
    if (receivedAt + RECEIPT_TTL_MS < now) receipts.delete(key);
  }
  while (receipts.size > MAX_RECEIPTS) {
    const first = receipts.keys().next().value as string | undefined;
    if (!first) break;
    receipts.delete(first);
  }
}

export function verifyWebhookSignatureWithSecret(body: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const provided = signature.replace(/^sha256=/i, "").trim();
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyWebhookSignature(body: string, signature?: string) {
  return verifyWebhookSignatureWithSecret(body, signature, calleConfig.webhookSecret);
}

/** Parses the signed provider payload without exposing or persisting its raw sensitive copy. */
export function parseWebhook(body: string, signature?: string, secret = calleConfig.webhookSecret): CalleWebhookEvent {
  if (!verifyWebhookSignatureWithSecret(body, signature, secret)) {
    throw new Error("Invalid CALL-E webhook signature");
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    throw new Error("Invalid CALL-E webhook JSON");
  }
  const candidate = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    throw new Error("CALL-E webhook is missing a call or event id");
  }
  if (candidate.status !== undefined && !isKnownProviderStatus(candidate.status)) {
    throw new Error("CALL-E webhook has an unknown call status");
  }
  return candidate as CalleWebhookEvent;
}

function receiptKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Accepts a verified webhook exactly once for duplicate side-effect handling. Duplicate
 * deliveries remain successful (200) but are identified without retaining raw payloads.
 */
export function acceptCalleWebhook(
  body: string,
  signature?: string,
  secret = calleConfig.webhookSecret,
): { event: CalleWebhookEvent; duplicate: boolean; receiptId: string } {
  const event = parseWebhook(body, signature, secret);
  gcReceipts();
  const key = receiptKey(body);
  const duplicate = receipts.has(key);
  receipts.set(key, Date.now());
  return { event, duplicate, receiptId: key.slice(0, 16) };
}

export function resetWebhookReceiptLedger(): void {
  receipts.clear();
}

export function handleCalleWebhook(req: { rawBody?: Buffer; body?: unknown; header: (name: string) => string | undefined }) {
  const body = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString("utf8")
    : Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});
  return acceptCalleWebhook(body, req.header("x-calle-signature") ?? undefined);
}

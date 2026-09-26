import { createHmac, timingSafeEqual } from "node:crypto";
import type { CallRepository } from "./repository";
import type { CalleEvent } from "./types";

export function verifySignature(raw: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(String(signature).replace(/^sha256=/i, ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function ingestEvent(
  raw: string,
  repo: CallRepository,
  secret?: string,
  signature?: string,
): Promise<{ accepted: boolean; deduplicated: boolean; eventId: string }> {
  if (!secret || !signature || !verifySignature(raw, signature, secret)) {
    throw new Error("Invalid webhook signature");
  }
  const event = JSON.parse(raw) as CalleEvent;
  if (!event?.id || !event.data?.id || !event.type) {
    throw new Error("Webhook payload missing event id, type, or call id");
  }
  const fresh = await repo.putEvent(event);
  if (fresh) await repo.putCall(event.data);
  return { accepted: true, deduplicated: !fresh, eventId: event.id };
}

// ─── Webhook Storage + Delivery ──────────────────────────────────────────────
// Stores a user-configured webhook URL (encrypted) in Redis.
// Fires call-completion payloads to that URL when a call reaches terminal state.

import { decryptString, encryptString } from "./crypto";
import { getRedisClient } from "./redis";
import { logError } from "./observability";

const WEBHOOK_KEY_PREFIX = "calle:webhook:";
const WEBHOOK_TTL_SECONDS = 365 * 24 * 3600; // 1 year

function webhookKey(email: string): string {
  return `${WEBHOOK_KEY_PREFIX}${email}`;
}

export async function getWebhookUrl(email: string): Promise<string | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  const val = await redis.get(webhookKey(email));
  if (!val) return null;
  return decryptString(val);
}

export async function setWebhookUrl(email: string, url: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) throw new Error("Storage unavailable");
  await redis.set(webhookKey(email), encryptString(url), "EX", WEBHOOK_TTL_SECONDS);
}

export async function deleteWebhookUrl(email: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  await redis.del(webhookKey(email));
}

export interface WebhookPayload {
  event: "call.completed" | "call.failed";
  call_id: string;
  run_id?: string;
  phone_masked: string;
  goal: string;
  outcome?: {
    task_completed: boolean;
    confidence_label: string;
    confidence_score: number;
  } | null;
  post_summary?: string | null;
  timestamp: string;
}

/** Fire-and-forget webhook delivery. Errors are logged, never thrown. */
export async function fireWebhook(url: string, payload: WebhookPayload): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logError("Webhook delivery failed", err, { details: { url } });
  }
}

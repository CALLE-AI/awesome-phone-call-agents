// ─── Call Templates (server-side, encrypted in Redis) ────────────────────────
// Persists user-defined named call templates per user.
// All values AES-256-GCM encrypted at rest.

import { decryptString, encryptString } from "./crypto";
import { getRedisClient } from "./redis";

const TEMPLATES_KEY_PREFIX = "calle:templates:";
const MAX_TEMPLATES = 20;
const TEMPLATES_TTL_SECONDS = 365 * 24 * 3600; // 1 year

export interface CallTemplate {
  id: string;
  name: string;
  phone?: string;
  goal: string;
  createdAt: string; // ISO string
}

function templatesKey(email: string): string {
  return `${TEMPLATES_KEY_PREFIX}${email}`;
}

export async function saveTemplate(email: string, template: CallTemplate): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) throw new Error("Storage unavailable");
  const key = templatesKey(email);
  const count = await redis.hlen(key);
  if (count >= MAX_TEMPLATES) throw new Error("Template limit reached (20)");
  const encrypted = encryptString(JSON.stringify(template));
  await redis.hset(key, template.id, encrypted);
  await redis.expire(key, TEMPLATES_TTL_SECONDS);
}

export async function getTemplates(email: string): Promise<CallTemplate[]> {
  const redis = await getRedisClient();
  if (!redis) return [];
  const key = templatesKey(email);
  const hash = await redis.hgetall(key);
  if (!hash) return [];
  const templates: CallTemplate[] = [];
  for (const val of Object.values(hash)) {
    try {
      const dec = decryptString(val);
      if (dec) templates.push(JSON.parse(dec) as CallTemplate);
    } catch { /* skip */ }
  }
  return templates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteTemplate(email: string, id: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) throw new Error("Storage unavailable");
  await redis.hdel(templatesKey(email), id);
}

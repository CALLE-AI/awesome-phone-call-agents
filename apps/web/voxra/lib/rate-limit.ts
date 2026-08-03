import { NextRequest } from "next/server";
import { getRedisClient } from "@/lib/redis";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('PEXPIRE', key, windowMs)
end

local ttl = redis.call('PTTL', key)
local allowed = 0
if current <= limit then
  allowed = 1
end

return {allowed, current, ttl}
`;

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function checkRateLimit(
  req: NextRequest,
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const clientKey = `${key}:${getClientIp(req)}`;

  const redis = await getRedisClient();
  if (redis) {
    try {
      const result = (await redis.eval(
        RATE_LIMIT_LUA,
        1,
        `rl:${clientKey}`,
        String(maxRequests),
        String(windowMs)
      )) as [number, number, number];

      const allowed = Number(result[0]) === 1;
      const ttlMs = Math.max(0, Number(result[2]) || windowMs);
      return {
        allowed,
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
      };
    } catch {
      // Fall back to in-memory limiter if Redis is temporarily unavailable.
    }
  }

  const now = Date.now();
  const bucket = buckets.get(clientKey);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(clientKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  if (bucket.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  buckets.set(clientKey, bucket);
  return {
    allowed: true,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

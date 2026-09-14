import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A read is only allowed for a call this demo placed.
 *
 * The first version of the live route let anyone pass a call id and read it
 * back with the server's key. That is an unauthenticated window onto every call
 * on the account, transcripts included, and the fact that ids look random is
 * not access control.
 *
 * The fix is not a password on the endpoint. It is that a read has to present a
 * token only the POST could have produced, so an id nobody was handed cannot be
 * read at all. Enumeration stops being slow and starts being impossible.
 *
 * Stateless on purpose: an HMAC over the call id needs no store, survives a
 * cold start, and cannot drift out of sync with a cache.
 */

/**
 * The signing secret.
 *
 * A dedicated variable if one is set. Otherwise derived from the API key, which
 * is already a secret this process holds, so the demo works with no extra
 * configuration and the derived value never leaves the server.
 */
function secret(): string | null {
  const explicit = process.env.DEMO_READ_SECRET?.trim();
  if (explicit) return explicit;
  const apiKey = process.env.CALLE_API_KEY?.trim();
  if (!apiKey) return null;
  return createHmac("sha256", apiKey).update("asheard:read-token:v1").digest("hex");
}

export function issueReadToken(callId: string): string | null {
  const key = secret();
  if (key === null) return null;
  return createHmac("sha256", key).update(callId).digest("hex").slice(0, 32);
}

/** Constant time, because a comparison that returns early leaks the answer. */
export function readTokenValid(callId: string, presented: string): boolean {
  const expected = issueReadToken(callId);
  if (expected === null || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(presented));
}

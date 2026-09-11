/**
 * What a webhook delivery is allowed to tell us.
 *
 * CALL-E deliveries are unsigned, so anybody holding the URL can post anything.
 * The only thing taken from a delivery is which call to go and look at. The
 * call itself is then fetched from CALL-E with the server's key, and that is
 * the only version of it that is stored or shown.
 */

const CALL_ID = /^call_[A-Za-z0-9_-]{6,64}$/;
const EVENT_ID = /^evt_[A-Za-z0-9_-]{6,64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The call id a delivery points at, if it points at one that looks real. */
export function callIdFrom(payload: unknown): string | null {
  const body = record(payload);
  if (body === null) return null;
  const data = record(body["data"]);
  for (const candidate of [data?.["id"], data?.["call_id"], body["call_id"], body["id"]]) {
    if (typeof candidate === "string" && CALL_ID.test(candidate)) return candidate;
  }
  return null;
}

/** The event id, from the header CALL-E sends or the envelope, for dedup display only. */
export function eventIdFrom(header: string | null, payload: unknown): string | null {
  if (header !== null && EVENT_ID.test(header.trim())) return header.trim();
  const id = record(payload)?.["id"];
  return typeof id === "string" && EVENT_ID.test(id) ? id : null;
}

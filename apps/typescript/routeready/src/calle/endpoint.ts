import type { CalleClientOptions } from "@call-e/calle";

/** Where CALL-E API keys may be sent. Only HTTPS origins run by CALL-E belong here. */
export const APPROVED_CALLE_ORIGINS: readonly string[] = ["https://api.heycall-e.com"];

/** Keys that are not real credentials. Only these may be sent to an origin outside the approved list, such as a local fake. */
export const DUMMY_KEY_PREFIX = "dummy-";

export function isDummyKey(apiKey: string): boolean {
  return apiKey.startsWith(DUMMY_KEY_PREFIX);
}

/**
 * CALL-E client options for a key and an optional base URL override. A real
 * key only ever goes to an approved HTTPS origin; any other origin, such as a
 * local fake of the API, accepts dummy keys only. Throws otherwise.
 */
export function calleClientOptions(apiKey: string, baseUrl?: string): CalleClientOptions {
  const override = baseUrl?.trim();
  if (!override) return { apiKey };
  let origin: string;
  try {
    const url = new URL(override);
    if (url.username || url.password) throw new Error("credentials in URL");
    origin = url.origin;
  } catch {
    throw new Error("CALLE_BASE_URL is not a valid URL.");
  }
  if (APPROVED_CALLE_ORIGINS.includes(origin)) return { apiKey, baseUrl: origin };
  if (isDummyKey(apiKey)) return { apiKey, baseUrl: override.replace(/\/$/, "") };
  throw new Error(
    `CALLE_BASE_URL points at ${origin}, which is not an approved CALL-E origin. Only keys starting with "${DUMMY_KEY_PREFIX}" may be sent there.`,
  );
}

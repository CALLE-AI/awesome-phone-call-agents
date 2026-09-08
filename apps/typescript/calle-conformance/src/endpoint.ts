/**
 * Where the API key is allowed to be sent.
 *
 * `CALLE_BASE_URL` exists because the SDK documents a test host alongside the
 * production one, and `scripts/probe.ts` was written to find out whether that
 * host consumes credits. Reading it straight out of the environment and handing
 * it to the client is the problem: an override is a destination for the
 * credential, so anything that can set an environment variable can redirect the
 * key, and a plain http origin would put it on the wire in clear text.
 *
 * So the override survives, and the set of places it may point does not.
 */

const ALLOWED = ["https://api.heycall-e.com", "https://test-api.heycall-e.com"] as const;

export function baseUrl(): string {
  const raw = process.env.CALLE_BASE_URL?.trim();
  if (raw === undefined || raw === "") return ALLOWED[0];

  const trimmed = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`CALLE_BASE_URL is not a URL: ${trimmed}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `CALLE_BASE_URL must be https, so the API key is not sent in clear text. Got ${parsed.protocol}//`,
    );
  }
  if (!ALLOWED.includes(parsed.origin as (typeof ALLOWED)[number])) {
    throw new Error(
      `CALLE_BASE_URL may only point at a CALL-E origin, because it decides where the\n` +
        `API key is sent. Allowed:\n  ${ALLOWED.join("\n  ")}\nGot: ${parsed.origin}`,
    );
  }
  return parsed.origin;
}

/**
 * A destination printed to a terminal ends up pasted into issues and screen
 * recordings. The published testing hotline is public and stays legible; every
 * other number keeps its country code and its last two digits, which is enough
 * to tell two destinations apart and not enough to dial one.
 */
export const PUBLIC_TESTING_HOTLINE = "+12763229632";

export function maskPhone(phone: string): string {
  if (phone === PUBLIC_TESTING_HOTLINE) return `${phone} (CALL-E testing hotline)`;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 6) return "*".repeat(phone.length);
  const cc = digits.slice(0, digits.length > 11 ? 3 : 2);
  return `+${cc}${"*".repeat(digits.length - cc.length - 2)}${digits.slice(-2)}`;
}

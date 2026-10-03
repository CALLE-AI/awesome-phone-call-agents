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

export const ALLOWED = ["https://api.heycall-e.com", "https://test-api.heycall-e.com"] as const;

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

/**
 * The operator's destination override.
 *
 * `CALLE_TEST_PHONE` decides which telephone rings, so it is a destination in the
 * same sense `CALLE_BASE_URL` is, and it was reaching `calls.create` exactly as
 * typed. A transposed digit dials a stranger, and the only scripts that read it
 * are the ones that place a real call.
 *
 * Left unset it stays on the hotline CALL-E publishes for testing, which nobody
 * has to authorise because the platform put it there for this. Set to anything
 * else it has to be well formed, and the operator has to say in that same run
 * that whoever answers agreed to be called. The attestation is the operator's
 * word, which is what the repository's review policy asks for, and it is spent
 * per run rather than stored, so it cannot be set once and forgotten.
 *
 * The refusals mask the number. An operator who mistypes a destination should
 * not have the mistyped line printed into a terminal they are about to paste.
 */
const E164 = /^\+[1-9]\d{7,14}$/;

export const AUTHORIZED_FLAG = "--i-have-authorization-for-this-destination";

export function assertDialable(phone: string, argv: readonly string[] = process.argv): string {
  if (!E164.test(phone)) {
    throw new Error(
      `CALLE_TEST_PHONE is not E.164: ${maskPhone(phone)}\n` +
        "Expected a leading +, a country code, and 8 to 15 digits in total, with no\n" +
        "spaces, dashes or brackets. Nothing was sent.",
    );
  }
  if (phone === PUBLIC_TESTING_HOTLINE) return phone;
  if (!argv.includes(AUTHORIZED_FLAG)) {
    throw new Error(
      `CALLE_TEST_PHONE points somewhere other than the published testing hotline: ` +
        `${maskPhone(phone)}\n` +
        "A real telephone will ring. Re-run with " + AUTHORIZED_FLAG + " to state that\n" +
        "whoever answers that line has agreed to be called. Nothing was sent.",
    );
  }
  return phone;
}

/** The destination those scripts dial: the published hotline unless an operator overrode it. */
export function testDestination(argv: readonly string[] = process.argv): string {
  const raw = process.env.CALLE_TEST_PHONE?.trim();
  if (raw === undefined || raw === "") return PUBLIC_TESTING_HOTLINE;
  return assertDialable(raw, argv);
}

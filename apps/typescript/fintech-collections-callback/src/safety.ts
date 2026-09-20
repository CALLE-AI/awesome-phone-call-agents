// Safety boundary helpers, kept dependency-free so they are easy to unit-test:
//   - resolveBaseUrl:   allowlist the CALL-E base URL before any bearer key is
//                       attached, so credentials never reach an arbitrary origin.
//   - maskPhone:        mask destinations in logs and reports.
//   - assertLiveInputAuthorized: fail closed so live mode never dials the
//                       checked-in sample fixtures.

/** Official CALL-E API host(s) that credentials may be sent to. */
const ALLOWED_HOST_EXACT = "heycall-e.com";
const ALLOWED_HOST_SUFFIX = ".heycall-e.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/**
 * Resolve and validate the CALL-E base URL. Fails closed: only official HTTPS
 * `*.heycall-e.com` origins, or a loopback host (for local fake servers), are
 * allowed. Anything else throws before the bearer key is ever attached.
 */
export function resolveBaseUrl(raw?: string): string {
  const candidate = raw && raw.trim() ? raw.trim() : DEFAULT_BASE_URL;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`CALLE_BASE_URL is not a valid URL: ${candidate}`);
  }

  const host = url.hostname.toLowerCase();
  const isOfficial =
    url.protocol === "https:" && (host === ALLOWED_HOST_EXACT || host.endsWith(ALLOWED_HOST_SUFFIX));
  const isLoopback =
    (url.protocol === "https:" || url.protocol === "http:") && LOOPBACK_HOSTS.has(host);

  if (isOfficial || isLoopback) return url.origin;

  throw new Error(
    `Refusing to send credentials to non-allowlisted CALLE_BASE_URL "${candidate}". ` +
      `Allowed: https://*.heycall-e.com, or a loopback host for local testing.`,
  );
}

/**
 * Mask a phone number for logs and reports, showing only the last two digits,
 * e.g. "+12025550143" -> "+*********43". Preserves a leading "+".
 */
export function maskPhone(phone: string): string {
  if (!phone) return phone;
  const plus = phone.trim().startsWith("+") ? "+" : "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 2) return `${plus}${"*".repeat(digits.length)}`;
  return `${plus}${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
}

/**
 * Fail closed: live mode must never dial the checked-in sample fixtures. It
 * requires operator-authorized recipients supplied at run time via `--smoke`
 * (SMOKE_* env). Throws otherwise.
 */
export function assertLiveInputAuthorized(args: { live: boolean; smoke: boolean }): void {
  if (args.live && !args.smoke) {
    throw new Error(
      "Live mode will not dial the checked-in sample fixtures. Provide operator-authorized " +
        "recipients via --smoke (SMOKE_* env). Fixtures are for dry-run preview only (drop --live).",
    );
  }
}

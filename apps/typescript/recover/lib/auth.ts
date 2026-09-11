import { NextRequest } from "next/server";

/**
 * Standard API Key for Recover services.
 * Can be configured via RECOVER_API_KEY in .env.local,
 * defaults to a secure development token for demo access.
 */
export const RECOVER_API_KEY = process.env.RECOVER_API_KEY || "recover_demo_key_sec_9942";

/**
 * Authenticates incoming API requests against the server authorization key.
 * Accepts either:
 *  - Header: `x-recover-key: <key>`
 *  - Header: `Authorization: Bearer <key>`
 */
export function validateApiAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const customKeyHeader = req.headers.get("x-recover-key");

  if (customKeyHeader && customKeyHeader.trim() === RECOVER_API_KEY) {
    return true;
  }

  if (authHeader) {
    const [scheme, token] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token?.trim() === RECOVER_API_KEY) {
      return true;
    }
  }

  // Allow same-origin browser requests in development if x-recover-key is omitted but sec-fetch-site is same-origin
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" && process.env.NODE_ENV !== "production") {
    return true;
  }

  return false;
}

/**
 * Strict ASCII E.164 Validator.
 * Must begin with '+', followed by country code (1-9) and 1-14 digits.
 * Rejects any non-ASCII characters, whitespace, hyphens, or formatting noise.
 */
export const ASCII_E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function validateStrictE164(phone: string): { valid: boolean; normalized?: string; error?: string } {
  if (typeof phone !== "string") {
    return { valid: false, error: "Phone number must be a string." };
  }

  const trimmed = phone.trim();

  // Strict ASCII-only check (reject any Unicode / multibyte whitespace or symbols)
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return { valid: false, error: "Phone number contains non-ASCII characters." };
    }
  }

  if (!ASCII_E164_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: "Phone number must be valid strict ASCII E.164 format (e.g. +12763229632, +15550199).",
    };
  }

  return { valid: true, normalized: trimmed };
}

/**
 * Server-Bound Destination Authorization.
 * Ensures an outbound call request can ONLY target the exact, pre-authorized
 * destination recorded in the server's subscriber registry.
 */
export function verifyServerBoundDestination(requestedPhone: string, registeredPhone: string): boolean {
  return requestedPhone.trim() === registeredPhone.trim();
}

import { NextRequest } from "next/server";

/**
 * Configured API Key for Recover services.
 * Fails closed: Must be explicitly configured via RECOVER_API_KEY.
 * No hardcoded published fallbacks or development bypasses permitted.
 */
export const RECOVER_API_KEY = process.env.RECOVER_API_KEY?.trim() || "";

/**
 * Authenticates incoming API requests against the server authorization key.
 * Strictly requires RECOVER_API_KEY to be configured; fails closed otherwise.
 * Accepts either:
 *  - Header: `x-recover-key: <key>`
 *  - Header: `Authorization: Bearer <key>`
 */
export function validateApiAuth(req: NextRequest): boolean {
  if (!RECOVER_API_KEY) {
    // Fail closed: refusal to accept requests without an explicitly configured secret
    return false;
  }

  const customKeyHeader = req.headers.get("x-recover-key");
  if (customKeyHeader && customKeyHeader.trim() === RECOVER_API_KEY) {
    return true;
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const [scheme, token] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token?.trim() === RECOVER_API_KEY) {
      return true;
    }
  }

  return false;
}

/**
 * Authenticates incoming webhook signals against a configured webhook secret.
 * Fails closed if the corresponding secret environment variable is missing or empty.
 */
export function validateWebhookAuth(req: NextRequest, expectedSecret: string | undefined): boolean {
  if (!expectedSecret || !expectedSecret.trim()) {
    // Fail closed if the webhook secret is not configured
    return false;
  }

  const secret = expectedSecret.trim();
  const headerSecret =
    req.headers.get("x-calle-webhook-secret") ||
    req.headers.get("x-webhook-secret") ||
    req.headers.get("x-webhook-token");

  if (headerSecret && headerSecret.trim() === secret) {
    return true;
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const [scheme, token] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token?.trim() === secret) {
      return true;
    }
  }

  const queryToken = req.nextUrl.searchParams.get("token");
  if (queryToken && queryToken.trim() === secret) {
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

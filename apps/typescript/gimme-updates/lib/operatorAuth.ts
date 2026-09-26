import { createHash, timingSafeEqual } from "crypto";

import { isAllowedRecipient, isAsciiE164 } from "@/lib/privacy";

/** Same condition as CALLE_DRY_RUN in lib/calle.ts, without importing it. */
function realCallsConfigured(): boolean {
  return (
    process.env.ALLOW_REAL_CALLS === "true" &&
    process.env.CALLE_DRY_RUN === "false"
  );
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function secretMatches(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

function presentedSecret(request: Request, body: unknown): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const bearer = authorization.match(/^Bearer\s+(\S+)\s*$/i);
    if (bearer) {
      return bearer[1];
    }
  }

  const header = request.headers.get("x-operator-secret");
  if (header && header.trim()) {
    return header.trim();
  }

  if (body && typeof body === "object" && "operatorSecret" in body) {
    const field = (body as { operatorSecret?: unknown }).operatorSecret;
    if (typeof field === "string" && field.trim()) {
      return field.trim();
    }
  }

  return null;
}

/**
 * True only when OPERATOR_SECRET is set and the request presents the same
 * value via Authorization: Bearer, x-operator-secret, or operatorSecret.
 * An unset secret authorizes nobody.
 */
export function isOperatorAuthorized(request: Request, body?: unknown): boolean {
  const expected = process.env.OPERATOR_SECRET;
  if (!expected || !expected.trim()) {
    return false;
  }
  const presented = presentedSecret(request, body);
  if (!presented) {
    return false;
  }
  return secretMatches(presented, expected.trim());
}

export type RealCallGate =
  | { action: "dry_run" }
  | { action: "allow" }
  | { action: "reject"; status: 401 | 403; error: string };

/**
 * Decides whether this phone may receive a real CALL-E call.
 * ALLOW_REAL_CALLS / CALLE_DRY_RUN alone never allow it: the caller must
 * already have checked the operator secret, and the number must be ASCII
 * E.164 and listed in ALLOWED_RECIPIENTS.
 */
export function evaluateRealCallGate(
  phoneNumber: string,
  operatorAuthorized: boolean
): RealCallGate {
  if (!realCallsConfigured()) {
    return { action: "dry_run" };
  }

  if (!operatorAuthorized) {
    return {
      action: "reject",
      status: 401,
      error: "Operator authorization is required to place a real call.",
    };
  }

  if (!isAsciiE164(phoneNumber) || !isAllowedRecipient(phoneNumber)) {
    return {
      action: "reject",
      status: 403,
      error:
        "Real calls are limited to ASCII E.164 numbers listed in ALLOWED_RECIPIENTS.",
    };
  }

  return { action: "allow" };
}

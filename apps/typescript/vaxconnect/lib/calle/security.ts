import { NextResponse } from "next/server";

/**
 * Shared safety gate for every route that can trigger a real CALL-E call.
 *
 * Three checks are required, in this order, on every such route:
 *   1. Operator authorization  - a valid `Authorization: Bearer <CALLE_INTERNAL_SECRET>` header.
 *   2. No-call default         - CALLE_ENABLE_REAL_CALLS must be the literal string "true".
 *   3. Authorized recipient    - the target phone must be valid E.164 AND present in
 *                                CALLE_ALLOWED_RECIPIENTS.
 *
 * Never call the CALL-E SDK/CLI before all three checks have passed.
 */

const internalSecret = process.env.CALLE_INTERNAL_SECRET;

export const REAL_CALLS_ENABLED =
    process.env.CALLE_ENABLE_REAL_CALLS === "true";

const allowedRecipients = new Set(
    (process.env.CALLE_ALLOWED_RECIPIENTS ?? "")
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean)
);

export function isValidE164(phone: unknown): phone is string {
    return (
        typeof phone === "string" &&
        /^\+[1-9]\d{7,14}$/.test(phone)
    );
}

export function isAuthorizedRecipient(phone: unknown): phone is string {
    return isValidE164(phone) && allowedRecipients.has(phone);
}

/**
 * Checks the `Authorization: Bearer <secret>` header against CALLE_INTERNAL_SECRET.
 * Returns true only if the secret is configured AND matches.
 */
export function isOperatorAuthorized(req: Request): boolean {
    if (!internalSecret) {
        return false;
    }

    const authHeader = req.headers.get("authorization");

    return authHeader === `Bearer ${internalSecret}`;
}

export function unauthorizedResponse() {
    return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
    );
}

export function realCallsDisabledResponse() {
    return NextResponse.json(
        { ok: false, error: "Real CALL-E calls are disabled." },
        { status: 403 }
    );
}

export function recipientNotAuthorizedResponse() {
    return NextResponse.json(
        {
            ok: false,
            error: "Recipient is not authorized for real calls.",
        },
        { status: 403 }
    );
}

export function invalidRecipientResponse() {
    return NextResponse.json(
        {
            ok: false,
            error: "Recipient must be a valid E.164 phone number.",
        },
        { status: 400 }
    );
}

/**
 * Runs the operator-auth + no-call-default checks shared by every call route.
 * Returns a NextResponse to send back immediately if either check fails, or
 * null if the caller may proceed to the recipient check and then the call.
 */
export function guardOperatorAndRealCalls(
    req: Request
): ReturnType<typeof unauthorizedResponse> | null {
    if (!isOperatorAuthorized(req)) {
        return unauthorizedResponse();
    }

    if (!REAL_CALLS_ENABLED) {
        return realCallsDisabledResponse();
    }

    return null;
}

/**
 * Validates a recipient phone against format + the authorized allow-list.
 * Returns a NextResponse to send back immediately if invalid/unauthorized,
 * or null if the phone is clear to call.
 */
export function guardRecipient(
    phone: unknown
): ReturnType<typeof invalidRecipientResponse> | null {
    if (!isValidE164(phone)) {
        return invalidRecipientResponse();
    }

    if (!allowedRecipients.has(phone)) {
        return recipientNotAuthorizedResponse();
    }

    return null;
}

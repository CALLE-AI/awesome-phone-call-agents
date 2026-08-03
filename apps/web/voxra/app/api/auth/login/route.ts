import { NextRequest, NextResponse } from "next/server";
import { createAuthState, createBrokerSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";

/**
 * POST /api/auth/login
 * Creates a new CALL-E broker session and returns the login URL + session metadata.
 * The client opens the login URL, then polls /api/auth/callback with the session_id.
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "auth-login", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please retry shortly." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const session = await createBrokerSession();
    const authState = await createAuthState(session);
    return NextResponse.json({
      auth_state: authState,
      login_url:      session.login_url,
      poll_after_ms:  session.poll_after_ms ?? 2000,
    });
  } catch (err) {
    logError("Auth session creation failed", err, { route: "/api/auth/login", requestId });
    return NextResponse.json({ error: "Failed to create auth session" }, { status: 502 });
  }
}

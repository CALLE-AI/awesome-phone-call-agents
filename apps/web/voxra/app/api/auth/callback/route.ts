import { NextRequest, NextResponse } from "next/server";
import {
  clearAuthState,
  getBrokerSessionStatus,
  getAuthStateSession,
  exchangeBrokerSession,
  getCalleSession,
  setCalleSessionCookie,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";

/**
 * POST /api/auth/callback
 * Body: { auth_state }
 * Polls the broker for the session status.
 *   - status PENDING/AUTHORIZED → returns { status }
 *   - status AUTHORIZED → exchanges and sets session cookie, returns { status: "ok" }
 *   - status FAILED/EXPIRED  → returns { status: "failed", error }
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "auth-callback", 120, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please retry shortly." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  let body: { auth_state?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const authState = (body.auth_state ?? "").trim();
  if (!authState) {
    return NextResponse.json({ error: "auth_state is required" }, { status: 422 });
  }

  const partialSession = await getAuthStateSession(authState);
  if (!partialSession) {
    return NextResponse.json({ status: "failed", error: "Authentication state expired. Please retry login." }, { status: 401 });
  }

  try {
    const updated = await getBrokerSessionStatus(partialSession);
    const status  = updated.status;

    if (status === "AUTHORIZED") {
      // Exchange for a real token
      const calleSession = await exchangeBrokerSession(updated);
      await setCalleSessionCookie(calleSession);
      await clearAuthState(authState);
      return NextResponse.json({ status: "ok" });
    }

    if (status === "EXCHANGED") {
      // Idempotent success path: session may already be exchanged by a near-simultaneous
      // callback poll request. If cookie exists, treat as success.
      const existing = await getCalleSession();
      if (existing?.access_token) {
        await clearAuthState(authState);
        return NextResponse.json({ status: "ok" });
      }
      return NextResponse.json({ status: "failed", error: "Auth already exchanged; please retry login." }, { status: 401 });
    }

    if (status === "FAILED" || status === "EXPIRED") {
      await clearAuthState(authState);
      return NextResponse.json({ status: "failed", error: `Auth ${status.toLowerCase()}` }, { status: 401 });
    }

    // Still PENDING — return current status so client keeps polling
    return NextResponse.json({
      status:        status,
      poll_after_ms: updated.poll_after_ms ?? 2000,
    });
  } catch (err) {
    logError("Auth callback failed", err, { route: "/api/auth/callback", requestId });
    return NextResponse.json({ error: "Auth callback failed" }, { status: 502 });
  }
}

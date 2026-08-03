import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession, refreshCalleSession, setCalleSessionCookie } from "@/lib/auth";
import { planCall } from "@/lib/calle";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";
import { isInvalidTokenUpstreamError, mapCalleUpstreamError } from "@/lib/upstream-errors";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "calls-plan", 40, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please retry shortly." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { phone?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  const goal  = (body.goal  ?? "").trim();

  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 422 });
  if (!goal)  return NextResponse.json({ error: "goal is required" },  { status: 422 });

  // Basic E.164 check — must start with + and contain only digits after that
  if (!/^\+\d{7,15}$/.test(phone)) {
    return NextResponse.json(
      { error: "phone must be in E.164 format, e.g. +14155551234" },
      { status: 422 }
    );
  }

  try {
    const result = await planCall(session.access_token, phone, goal);
    return NextResponse.json(result);
  } catch (err) {
    if (isInvalidTokenUpstreamError(err) && session.refresh_token) {
      const refreshed = await refreshCalleSession(session);
      if (refreshed) {
        await setCalleSessionCookie(refreshed);
        try {
          const retryResult = await planCall(refreshed.access_token, phone, goal);
          return NextResponse.json(retryResult);
        } catch (retryErr) {
          logError("Call planning failed after refresh retry", retryErr, { route: "/api/calls/plan", requestId });
          const mappedRetry = mapCalleUpstreamError(retryErr, "Failed to plan call");
          return NextResponse.json({ error: mappedRetry.message }, { status: mappedRetry.status });
        }
      }
    }

    logError("Call planning failed", err, { route: "/api/calls/plan", requestId });
    const mapped = mapCalleUpstreamError(err, "Failed to plan call");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

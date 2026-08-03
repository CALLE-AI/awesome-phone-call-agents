import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession, refreshCalleSession, setCalleSessionCookie } from "@/lib/auth";
import { runCall } from "@/lib/calle";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";
import { isInvalidTokenUpstreamError, mapCalleUpstreamError } from "@/lib/upstream-errors";

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "calls-run", 40, 60_000);
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

  let body: { plan_id?: string; confirm_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const planId       = (body.plan_id       ?? "").trim();
  const confirmToken = (body.confirm_token ?? "").trim();

  if (!planId)       return NextResponse.json({ error: "plan_id is required" },       { status: 422 });
  if (!confirmToken) return NextResponse.json({ error: "confirm_token is required" }, { status: 422 });

  try {
    const result = await runCall(session.access_token, planId, confirmToken);
    return NextResponse.json(result);
  } catch (err) {
    if (isInvalidTokenUpstreamError(err) && session.refresh_token) {
      const refreshed = await refreshCalleSession(session);
      if (refreshed) {
        await setCalleSessionCookie(refreshed);
        try {
          const retryResult = await runCall(refreshed.access_token, planId, confirmToken);
          return NextResponse.json(retryResult);
        } catch (retryErr) {
          logError("Call run failed after refresh retry", retryErr, { route: "/api/calls/run", requestId });
          const mappedRetry = mapCalleUpstreamError(retryErr, "Failed to run call");
          return NextResponse.json({ error: mappedRetry.message }, { status: mappedRetry.status });
        }
      }
    }

    logError("Call run failed", err, { route: "/api/calls/run", requestId });
    const mapped = mapCalleUpstreamError(err, "Failed to run call");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

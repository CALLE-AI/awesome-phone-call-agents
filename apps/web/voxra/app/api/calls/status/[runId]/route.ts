import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession, refreshCalleSession, setCalleSessionCookie } from "@/lib/auth";
import { getCallStatus } from "@/lib/calle";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";
import { isInvalidTokenUpstreamError, mapCalleUpstreamError } from "@/lib/upstream-errors";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "calls-status", 300, 60_000);
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

  const { runId } = await params;
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 422 });
  }

  try {
    const result = await getCallStatus(session.access_token, runId);
    return NextResponse.json(result);
  } catch (err) {
    if (isInvalidTokenUpstreamError(err) && session.refresh_token) {
      const refreshed = await refreshCalleSession(session);
      if (refreshed) {
        await setCalleSessionCookie(refreshed);
        try {
          const retryResult = await getCallStatus(refreshed.access_token, runId);
          return NextResponse.json(retryResult);
        } catch (retryErr) {
          logError("Call status retrieval failed after refresh retry", retryErr, {
            route: "/api/calls/status/[runId]",
            requestId,
            details: { runId },
          });
          const mappedRetry = mapCalleUpstreamError(retryErr, "Failed to get call status");
          return NextResponse.json({ error: mappedRetry.message }, { status: mappedRetry.status });
        }
      }
    }

    logError("Call status retrieval failed", err, {
      route: "/api/calls/status/[runId]",
      requestId,
      details: { runId },
    });
    const mapped = mapCalleUpstreamError(err, "Failed to get call status");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

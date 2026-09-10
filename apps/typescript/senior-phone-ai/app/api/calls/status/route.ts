import { NextResponse } from "next/server";

import { getCalleCallSnapshot } from "@/lib/calle/client";
import { assertCalleCallId } from "@/lib/calle/status";
import { getRuntimeMode, requireSecret } from "@/lib/config/server";
import { authorizeRealtimeSessionRequest, FixedWindowRateLimiter } from "@/lib/realtime/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowRateLimiter(90, 60_000);
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (getRuntimeMode() !== "live") {
    return NextResponse.json({ error: "Call monitoring is disabled in preview mode" }, {
      status: 503,
      headers: noStoreHeaders,
    });
  }
  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) {
    return NextResponse.json({ error: access.message }, { status: access.status, headers: noStoreHeaders });
  }
  if (!limiter.consume()) {
    return NextResponse.json({ error: "Too many call status requests" }, {
      status: 429,
      headers: { ...noStoreHeaders, "Retry-After": "2" },
    });
  }

  let callId: string;
  try {
    const body = await request.json() as { callId?: unknown };
    callId = assertCalleCallId(typeof body.callId === "string" ? body.callId : "");
  } catch {
    return NextResponse.json({ error: "A valid CALL-E call ID is required" }, {
      status: 400,
      headers: noStoreHeaders,
    });
  }

  try {
    const snapshot = await getCalleCallSnapshot(callId, requireSecret("CALLE_API_KEY"));
    return NextResponse.json(snapshot, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ error: "Call status is unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}

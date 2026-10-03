import { NextResponse } from "next/server";

import { getCalleCallSnapshots } from "@/lib/calle/client";
import { listRegisteredCallIds, readCallDisplayTimeOverrides } from "@/lib/calle/registry";
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

  let callIds: string[];
  try {
    callIds = await listRegisteredCallIds(process.env.CALLE_MONITORED_CALL_IDS);
  } catch {
    return NextResponse.json({ error: "The monitored call registry is invalid" }, {
      status: 503,
      headers: noStoreHeaders,
    });
  }

  if (!callIds.length) {
    return NextResponse.json({ calls: [], unavailableCount: 0 }, { headers: noStoreHeaders });
  }

  try {
    const [snapshot, displayTimes] = await Promise.all([
      getCalleCallSnapshots(callIds, requireSecret("CALLE_API_KEY")),
      readCallDisplayTimeOverrides(),
    ]);
    return NextResponse.json({
      ...snapshot,
      calls: snapshot.calls.map((call) => ({
        ...call,
        createdAt: displayTimes[call.callId] ?? call.createdAt,
        callId: `${call.callId.slice(0, 14)}…`,
      })),
    }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ error: "Call status is unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}

import { NextResponse } from "next/server";

import { runDueScheduledCalls } from "@/lib/calle/schedule";
import { getRuntimeMode, requireSecret } from "@/lib/config/server";
import { FixedWindowRateLimiter } from "@/lib/realtime/access";
import { authorizeSchedulerRequest } from "@/lib/scheduler/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowRateLimiter(30, 60_000);
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (getRuntimeMode() !== "live") return NextResponse.json({ error: "Scheduler is disabled in preview mode" }, { status: 503, headers: noStoreHeaders });

  let schedulerSecret: string;
  try {
    schedulerSecret = requireSecret("SCHEDULER_SECRET");
  } catch {
    return NextResponse.json({ error: "Scheduler is not configured" }, { status: 503, headers: noStoreHeaders });
  }
  if (!authorizeSchedulerRequest(request.headers, schedulerSecret)) {
    return NextResponse.json({ error: "Scheduler authorization failed" }, { status: 401, headers: noStoreHeaders });
  }
  if (!limiter.consume()) return NextResponse.json({ error: "Too many scheduler requests" }, { status: 429, headers: noStoreHeaders });

  try {
    return NextResponse.json(await runDueScheduledCalls(requireSecret("CALLE_API_KEY")), { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ error: "Scheduled-call processing failed" }, { status: 502, headers: noStoreHeaders });
  }
}

import { NextResponse } from "next/server";

import { cancelScheduledCall, createScheduledCall, listScheduledCalls, runDueScheduledCalls } from "@/lib/calle/schedule";
import { getRuntimeMode, requireSecret } from "@/lib/config/server";
import { authorizeRealtimeSessionRequest, FixedWindowRateLimiter } from "@/lib/realtime/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowRateLimiter(90, 60_000);
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (getRuntimeMode() !== "live") return NextResponse.json({ error: "Scheduled calls are disabled in preview mode" }, { status: 503, headers: noStoreHeaders });
  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status, headers: noStoreHeaders });
  if (!limiter.consume()) return NextResponse.json({ error: "Too many schedule requests" }, { status: 429, headers: noStoreHeaders });

  let body: Record<string, unknown>;
  let secret: string;
  try {
    body = await request.json() as Record<string, unknown>;
    secret = requireSecret("CALLE_API_KEY");
  } catch {
    return NextResponse.json({ error: "Scheduled calls are not configured" }, { status: 503, headers: noStoreHeaders });
  }

  try {
    if (body.action === "list") {
      await runDueScheduledCalls(secret);
      return NextResponse.json({ calls: await listScheduledCalls(secret) }, { headers: noStoreHeaders });
    }
    if (body.action === "cancel") {
      if (typeof body.id !== "string") throw new Error("invalid schedule identifier");
      return NextResponse.json({ call: await cancelScheduledCall(body.id, secret) }, { headers: noStoreHeaders });
    }
    if (body.action === "create") {
      if (body.confirmed !== true) throw new Error("explicit confirmation is required");
      const call = await createScheduledCall({
        destinationE164: typeof body.destinationE164 === "string" ? body.destinationE164 : "",
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        purpose: typeof body.purpose === "string" ? body.purpose : "",
        briefingId: typeof body.briefingId === "string" ? body.briefingId : undefined,
      }, typeof body.scheduledFor === "string" ? body.scheduledFor : "", secret);
      return NextResponse.json({ call }, { status: 201, headers: noStoreHeaders });
    }
    throw new Error("unsupported schedule action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled call request is invalid";
    return NextResponse.json({ error: message }, { status: /already started|already used/.test(message) ? 409 : 400, headers: noStoreHeaders });
  }
}

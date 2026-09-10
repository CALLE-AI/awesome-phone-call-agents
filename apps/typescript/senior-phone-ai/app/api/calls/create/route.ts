import { NextResponse } from "next/server";

import { createCalleCall } from "@/lib/calle/client";
import { outboundCallPreview, type OutboundCallRequest } from "@/lib/calle/outbound";
import { recordOutboundCallResult, reserveOutboundCall } from "@/lib/calle/registry";
import { getRuntimeMode, requireSecret } from "@/lib/config/server";
import { authorizeRealtimeSessionRequest, FixedWindowRateLimiter } from "@/lib/realtime/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new FixedWindowRateLimiter(3, 60_000);
const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (getRuntimeMode() !== "live") {
    return NextResponse.json({ error: "Outbound calls are disabled in preview mode" }, { status: 503, headers: noStoreHeaders });
  }
  const access = authorizeRealtimeSessionRequest(request.headers);
  if (!access.allowed) return NextResponse.json({ error: access.message }, { status: access.status, headers: noStoreHeaders });
  if (!limiter.consume()) {
    return NextResponse.json({ error: "Too many call requests; wait before trying again" }, {
      status: 429,
      headers: { ...noStoreHeaders, "Retry-After": "60" },
    });
  }

  let callRequest: OutboundCallRequest;
  try {
    const body = await request.json() as Partial<OutboundCallRequest> & { confirmed?: unknown };
    if (body.confirmed !== true) throw new Error("explicit confirmation is required");
    callRequest = {
      destinationE164: typeof body.destinationE164 === "string" ? body.destinationE164 : "",
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      purpose: typeof body.purpose === "string" ? body.purpose : "",
    };
    outboundCallPreview(callRequest);
  } catch {
    return NextResponse.json({ error: "Confirmed call details are invalid" }, { status: 400, headers: noStoreHeaders });
  }

  let apiKey: string;
  try {
    apiKey = requireSecret("CALLE_API_KEY");
  } catch {
    return NextResponse.json({ error: "CALL-E is not configured" }, { status: 503, headers: noStoreHeaders });
  }

  let reserved: Awaited<ReturnType<typeof reserveOutboundCall>>;
  try {
    reserved = await reserveOutboundCall(callRequest);
  } catch {
    return NextResponse.json({ error: "This call conflicts with an existing or unresolved request" }, { status: 409, headers: noStoreHeaders });
  }
  if (reserved.state === "accepted" && reserved.callId) {
    return NextResponse.json({ callReference: `${reserved.callId.slice(0, 14)}…`, status: "queued" }, { headers: noStoreHeaders });
  }
  if (reserved.state === "unknown") {
    return NextResponse.json({ error: "This call has an unresolved dispatch and was not retried" }, { status: 409, headers: noStoreHeaders });
  }

  try {
    const result = await createCalleCall(callRequest, apiKey);
    await recordOutboundCallResult(callRequest.idempotencyKey, { state: "accepted", callId: result.callId });
    return NextResponse.json({ callReference: `${result.callId.slice(0, 14)}…`, status: result.status }, { status: 201, headers: noStoreHeaders });
  } catch {
    await recordOutboundCallResult(callRequest.idempotencyKey, { state: "unknown" }).catch(() => undefined);
    return NextResponse.json({ error: "Call dispatch is uncertain and will not be retried automatically" }, { status: 502, headers: noStoreHeaders });
  }
}

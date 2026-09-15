import { NextResponse } from "next/server";

import { createCalleCall, isDefinitiveCalleRejection } from "@/lib/calle/client";
import { resolveBriefingTask } from "@/lib/briefings/store";
import { outboundCallPreview, type OutboundCallRequest } from "@/lib/calle/outbound";
import { recordOutboundCallResult, reserveOutboundCall } from "@/lib/calle/registry";
import { getRuntimeMode, requireSecret } from "@/lib/config/server";
import { callFailureCode, writeCallLog } from "@/lib/observability/call-log";
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
      briefingId: typeof body.briefingId === "string" ? body.briefingId : undefined,
    };
    outboundCallPreview(callRequest);
    if (callRequest.briefingId) await resolveBriefingTask(callRequest.briefingId);
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
    await writeCallLog({
      destinationE164: callRequest.destinationE164,
      event: "provider_accepted",
      requestId: reserved.idempotencyKey,
      source: "registry",
    });
    return NextResponse.json({ callReference: `${reserved.callId.slice(0, 14)}…`, status: "queued" }, { headers: noStoreHeaders });
  }

  const dispatchRequest = reserved.state === "unknown"
    ? { ...callRequest, idempotencyKey: reserved.idempotencyKey }
    : callRequest;
  const startedAt = Date.now();
  try {
    await writeCallLog({
      destinationE164: dispatchRequest.destinationE164,
      event: "provider_request_started",
      requestId: dispatchRequest.idempotencyKey,
      source: "provider",
    });
    const result = await createCalleCall(dispatchRequest, apiKey);
    await recordOutboundCallResult(dispatchRequest.idempotencyKey, { state: "accepted", callId: result.callId });
    await writeCallLog({
      destinationE164: dispatchRequest.destinationE164,
      durationMs: Date.now() - startedAt,
      event: "provider_accepted",
      requestId: dispatchRequest.idempotencyKey,
      source: "provider",
    });
    return NextResponse.json({ callReference: `${result.callId.slice(0, 14)}…`, status: result.status, followupRegistration: result.followupRegistration }, { status: 201, headers: noStoreHeaders });
  } catch (cause) {
    const rejected = isDefinitiveCalleRejection(cause);
    await recordOutboundCallResult(dispatchRequest.idempotencyKey, {
      state: rejected ? "rejected" : "unknown",
    }).catch(() => undefined);
    await writeCallLog({
      destinationE164: dispatchRequest.destinationE164,
      durationMs: Date.now() - startedAt,
      event: rejected ? "provider_rejected" : "provider_request_failed",
      providerCode: callFailureCode(cause),
      requestId: dispatchRequest.idempotencyKey,
      source: "provider",
    });
    if (rejected) {
      const guidanceByCode: Readonly<Record<string, string>> = {
        insufficient_balance: "Check the CALL-E account balance.",
        invalid_phone: "Check the selected country and destination number.",
        invalid_recipient: "Check the selected country and destination number.",
        no_recipients: "Enter a destination number.",
        policy_violation: "Revise the call instructions so they comply with CALL-E policy.",
        recipient_blocked: "CALL-E governance does not allow calls to this recipient.",
        unsupported_language: "Choose a language supported for the recipient's region.",
        unsupported_region: "CALL-E does not support this recipient region.",
      };
      const providerCode = cause.providerCode;
      const guidance = (providerCode && guidanceByCode[providerCode])
        ?? (cause.status === 422
          ? "Review the destination and call instructions, then create a new confirmation."
          : "Review the call details and CALL-E configuration, then create a new confirmation.");
      const diagnostic = providerCode ? `, ${providerCode}` : "";
      return NextResponse.json({
        error: `CALL-E rejected this request (HTTP ${cause.status}${diagnostic}). ${guidance}`,
      }, { status: 422, headers: noStoreHeaders });
    }
    return NextResponse.json({
      error: "CALL-E did not confirm acceptance. Review and confirm the same unchanged call again to reconcile it with the original idempotency key.",
    }, { status: 502, headers: noStoreHeaders });
  }
}

// File: src/app/api/calle/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { hasEvent, markEvent, findRfqByCallId, updateRfqTask } from "@/lib/store";
import { getCall, isLive } from "@/lib/calle";
import { env } from "@/lib/env";
import type { WebhookEnvelope } from "@/lib/calle-types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const eventId = req.headers.get("CALL-E-Event-Id") ?? req.headers.get("call-e-event-id");
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "missing CALL-E-Event-Id" }, { status: 400 });
  }

  // INVARIANT 6: idempotency — a re-delivered event is a no-op.
  if (hasEvent(eventId)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Optional shared secret: if configured, the sender must prove it.
  const secret = env.webhookSecret();
  if (secret) {
    const got = req.headers.get("X-GoodFaith-Webhook-Secret") ?? req.headers.get("x-goodfaith-webhook-secret");
    if (got !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let body: WebhookEnvelope;
  try {
    body = (await req.json()) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  markEvent(eventId);

  // The posted body is NOT trusted as evidence. Take ONLY the call id and rfq correlation
  // from it; the actual CallTask is re-fetched authoritatively from CALL-E below.
  const callId = body.data?.id;
  const rfqIdFromMeta = (body.data?.metadata?.rfq_id as string | undefined) ?? undefined;
  if (!callId) {
    return NextResponse.json({ ok: false, error: "missing call id" }, { status: 400 });
  }

  // Mock mode cannot re-fetch, so it must not write body-supplied evidence into the RFQ.
  if (!isLive()) {
    return NextResponse.json({ ok: true, note: "mock mode: webhook evidence ignored" }, { status: 202 });
  }

  // Authoritatively re-fetch the call from CALL-E (approved origin + our API key). The
  // re-fetched task is the ONLY evidence written; the untrusted body payload is ignored.
  let task;
  try {
    task = await getCall(callId);
  } catch {
    // Unknown call id or transient fetch failure: never write forged data.
    return NextResponse.json({ ok: false, error: "could not verify call" }, { status: 200 });
  }

  const rec = rfqIdFromMeta ? undefined : findRfqByCallId(callId);
  const targetRfq = rfqIdFromMeta ?? rec?.rfqId;
  if (targetRfq) updateRfqTask(targetRfq, task);

  return NextResponse.json({ ok: true });
}

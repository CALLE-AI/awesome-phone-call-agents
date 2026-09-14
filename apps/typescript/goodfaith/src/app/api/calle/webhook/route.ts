// File: src/app/api/calle/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { hasEvent, markEvent, findRfqByCallId, updateRfqTask } from "@/lib/store";
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

  let body: WebhookEnvelope;
  try {
    body = (await req.json()) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  markEvent(eventId);

  const task = body.data;
  if (task?.id) {
    const rfqIdFromMeta = (task.metadata?.rfq_id as string | undefined) ?? undefined;
    const rec = rfqIdFromMeta ? undefined : findRfqByCallId(task.id);
    const targetRfq = rfqIdFromMeta ?? rec?.rfqId;
    if (targetRfq) updateRfqTask(targetRfq, task);
    else if (rec) updateRfqTask(rec.rfqId, task);
  }

  return NextResponse.json({ ok: true });
}

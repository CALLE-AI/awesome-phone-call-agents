import { NextResponse } from "next/server";
import { getLiveCall } from "@/lib/calle";
import { recordSnapshot } from "@/lib/ledger";
import { eventProcessed, markEventProcessed, storeVerifiedCall } from "@/lib/webhook-store";

export const dynamic = "force-dynamic";

// Webhooks are unsigned, so their body is a hint only. The authoritative CALL-E record is re-read
// before caching, and an event is marked processed only after that verification succeeds.
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const callId = payload?.data?.id;
  const eventId = request.headers.get("CALL-E-Event-Id") ?? payload?.id;
  if (!callId || !/^call_[A-Za-z0-9_-]+$/.test(callId) || !eventId) return NextResponse.json({ ok: false }, { status: 400 });
  if (eventProcessed(eventId)) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const call = await getLiveCall(callId);
    if (call.metadata?.app === "pharmabridge") {
      storeVerifiedCall(call);
      void recordSnapshot(call.id, { call });
    }
    markEventProcessed(eventId);
    return NextResponse.json({ ok: true });
  } catch {
    // Return a retryable status. Browser polling remains a secondary source of truth.
    return NextResponse.json({ ok: false, retry: true }, { status: 503 });
  }
}

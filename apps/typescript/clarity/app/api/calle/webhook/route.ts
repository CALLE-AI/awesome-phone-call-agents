import { NextResponse } from "next/server";
import type { Call } from "@call-e/calle";
import { normalizeCall } from "@/lib/call-record";
import { findSessionByCallId, recordCall } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Terminal-result push. This is the bonus path: the demo depends on polling,
 * which needs no public URL. Current CALL-E deliveries are unsigned, so the
 * event is trusted only far enough to trigger a state write for a call this
 * process already started — an unknown call id is ignored.
 */
const seenEvents = new Set<string>();

export async function POST(request: Request) {
  let event: { id?: string; type?: string; data?: Call };
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const headerId = request.headers.get("CALL-E-Event-Id");
  if (headerId && event.id && headerId !== event.id) {
    return NextResponse.json({ error: "Event id header does not match body." }, { status: 400 });
  }

  const call = event.data;
  if (!call?.id) {
    return NextResponse.json({ error: "Event carried no call." }, { status: 400 });
  }

  // Deduplicate side effects by event id, as CALL-E's webhook guide requires.
  if (event.id) {
    if (seenEvents.has(event.id)) return NextResponse.json({ ok: true, duplicate: true });
    seenEvents.add(event.id);
  }

  const session = await findSessionByCallId(call.id);
  if (!session) {
    // Not a call this deployment placed. Acknowledge so CALL-E stops retrying.
    return NextResponse.json({ ok: true, ignored: true });
  }

  await recordCall(session.id, normalizeCall(call));
  return NextResponse.json({ ok: true });
}

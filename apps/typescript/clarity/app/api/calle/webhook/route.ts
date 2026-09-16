import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWebhook } from "@/lib/auth";
import { calleClient } from "@/lib/calle";
import { normalizeCall } from "@/lib/call-record";
import { verifyCall } from "@/lib/live-call";
import { findSessionByCallId, getSession, recordCall, withSessionLock } from "@/lib/session";

export const runtime = "nodejs";
// CALL-E currently sends unsigned events. Enable this only behind a trusted relay
// that supplies the separate bearer credential. Polling needs no webhook setup.
const EventSchema = z.object({ data: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }) });

export async function POST(request: Request) {
  const denied = requireWebhook(request);
  if (denied) return denied;
  const parsed = EventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  try {
    const callId = parsed.data.data.id;
    const session = await findSessionByCallId(callId);
    if (!session || session.replay) return NextResponse.json({ ok: true, ignored: true });
    await withSessionLock(session.id, async () => {
      const current = (await getSession(session.id))!;
      const verified = await calleClient().calls.get(callId);
      verifyCall(verified, current, callId);
      await recordCall(session.id, normalizeCall(verified));
    });
    // Re-delivery is safe: refresh the same provider record. No caller-controlled
    // event-ID cache can suppress a later valid delivery or poison retry handling.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not verify the call. Retry this event." }, { status: 502 });
  }
}

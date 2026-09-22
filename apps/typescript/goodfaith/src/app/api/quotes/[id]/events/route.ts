// File: src/app/api/quotes/[id]/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRfq, codeFromRfqId } from "@/lib/store";
import { listCallEvents } from "@/lib/calle";
import { isLive } from "@/lib/env";
import { scrubPhones } from "@/lib/normalize";
import { requireCaller } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Private read: in live mode the event stream carries real call diagnostics, so it
  // requires a caller token. Mock mode is the public demo and stays open.
  const unauthorized = requireCaller(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const rec = getRfq(id);

  // K10 fix (matches the quotes GET): in mock mode the event stream is synthesized from
  // the static fixture, so a cross-instance GET with no stored record rebuilds it from the
  // code encoded in the id rather than 404-ing. Live mode still requires the record.
  const callId = rec?.callId ?? "mock";
  const code = rec?.code ?? codeFromRfqId(id);
  if (!rec && isLive()) {
    return NextResponse.json({ data: null, error: "rfq not found" }, { status: 404 });
  }
  try {
    const events = await listCallEvents(callId, code);
    return NextResponse.json({ data: { events }, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "events fetch failed";
    return NextResponse.json({ data: { events: [] }, error: scrubPhones(msg) }, { status: 200 });
  }
}

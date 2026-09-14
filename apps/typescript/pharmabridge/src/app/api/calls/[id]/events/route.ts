import { NextResponse } from "next/server";
import { validCallAccessToken } from "@/lib/call-access";
import { describeError, listLiveEvents } from "@/lib/calle";
import { recordSnapshot } from "@/lib/ledger";
import { redactDeep } from "@/lib/phone";
import { getSimulatedEvents, isSimulatedId } from "@/lib/simulator";

export const dynamic = "force-dynamic";

const CALL_ID = /^call_[A-Za-z0-9_-]+$/;
const ACCESS_TOKEN_HEADER = "x-pharmabridge-call-token";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CALL_ID.test(id)) return NextResponse.json({ error: { code: "invalid_request", message: "Bad call id." } }, { status: 400 });
  if (!validCallAccessToken(id, request.headers.get(ACCESS_TOKEN_HEADER))) {
    return NextResponse.json({ error: { code: "forbidden", message: "This call record is not available to this browser session." } }, { status: 403 });
  }

  if (isSimulatedId(id)) {
    const events = getSimulatedEvents(id);
    if (!events) return NextResponse.json({ error: { code: "not_found", message: "Unknown call." } }, { status: 404 });
    void recordSnapshot(id, { events });
    return NextResponse.json({ events: redactDeep(events) });
  }

  try {
    const events = await listLiveEvents(id);
    void recordSnapshot(id, { events });
    return NextResponse.json({ events: redactDeep(events) });
  } catch (error) {
    const detail = describeError(error);
    return NextResponse.json({ error: detail }, { status: detail.status });
  }
}

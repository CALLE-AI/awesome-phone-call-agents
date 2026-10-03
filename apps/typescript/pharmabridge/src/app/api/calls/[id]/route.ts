import { NextResponse } from "next/server";
import { validCallAccessToken } from "@/lib/call-access";
import { describeError, getLiveCall } from "@/lib/calle";
import { recordSnapshot } from "@/lib/ledger";
import { redactDeep } from "@/lib/phone";
import { getSimulatedCall, isSimulatedId } from "@/lib/simulator";
import { webhookSnapshot } from "@/lib/webhook-store";

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
    const call = getSimulatedCall(id);
    if (!call) return NextResponse.json({ error: { code: "not_found", message: "Unknown call." } }, { status: 404 });
    void recordSnapshot(id, { call });
    return NextResponse.json({ call: redactDeep(call), via: "simulation" });
  }

  const pushed = webhookSnapshot(id);
  if (pushed) return NextResponse.json({ call: redactDeep(pushed), via: "webhook" });

  try {
    const call = await getLiveCall(id);
    void recordSnapshot(id, { call });
    return NextResponse.json({ call: redactDeep(call), via: "poll" });
  } catch (error) {
    const detail = describeError(error);
    return NextResponse.json({ error: detail }, { status: detail.status });
  }
}

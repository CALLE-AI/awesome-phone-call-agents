import { NextResponse } from "next/server";
import { operatorId, requireOperator } from "@/lib/auth";
import { calleClient } from "@/lib/calle";
import { isTerminal, normalizeCall } from "@/lib/call-record";
import { AMBIGUOUS_MESSAGE, callError, ownedSession, verifyCall } from "@/lib/live-call";
import { loadReplayRun, progressReplay } from "@/lib/replay";
import { publicView } from "@/lib/public-view";
import { recordCall, withSessionLock } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const session = await ownedSession(id, operatorId());
    if (!session.call) {
      const ambiguous = !!session.createState;
      return NextResponse.json({ view: publicView(session), pending: true, ambiguous, ...(ambiguous ? { error: AMBIGUOUS_MESSAGE } : {}) });
    }
    if (session.replay) {
      const { record, synthetic } = await loadReplayRun();
      const progressed = progressReplay(record, session.call.createdAt);
      return NextResponse.json({ view: publicView({ ...session, call: progressed, synthetic }), terminal: isTerminal(progressed.status) });
    }
    if (isTerminal(session.call.status)) return NextResponse.json({ view: publicView(session), terminal: true });
    try {
      return await withSessionLock(id, async () => {
        const current = await ownedSession(id, operatorId());
        const call = await calleClient().calls.get(current.callId!);
        verifyCall(call, current, current.callId!);
        const record = normalizeCall(call);
        await recordCall(id, record);
        return NextResponse.json({ view: publicView({ ...current, call: record }), terminal: isTerminal(record.status) });
      });
    } catch {
      return NextResponse.json({ view: publicView(session), pollError: "Could not refresh the call; showing the last verified result." });
    }
  } catch (error) {
    const { status, ...body } = callError(error);
    return NextResponse.json(body, { status });
  }
}

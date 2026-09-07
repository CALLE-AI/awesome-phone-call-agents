import { NextResponse } from "next/server";
import { calleClient } from "@/lib/calle";
import { isTerminal, normalizeCall } from "@/lib/call-record";
import { loadReplayRun, progressReplay } from "@/lib/replay";
import { buildResultView } from "@/lib/result";
import { findSessionByCallId, getSession, recordCall } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Poll proxy. `id` is a session id (and, forgivingly, a CALL-E call id), so the
 * browser never sees a CALL-E response or holds an API key.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = (await getSession(id)) ?? (await findSessionByCallId(id));
  if (!session) {
    return NextResponse.json({ error: "Unknown session." }, { status: 404 });
  }

  if (!session.call) {
    return NextResponse.json({ view: buildResultView(session), pending: true });
  }

  if (session.replay) {
    const { record, synthetic } = await loadReplayRun();
    const progressed = progressReplay(record, session.call.createdAt);
    const view = buildResultView({ ...session, call: progressed, replay: true, synthetic });
    return NextResponse.json({ view, terminal: isTerminal(progressed.status) });
  }

  // A terminal call never changes again — stop re-fetching it.
  if (isTerminal(session.call.status)) {
    return NextResponse.json({ view: buildResultView(session), terminal: true });
  }

  try {
    const call = await calleClient().calls.get(session.call.callId);
    const record = normalizeCall(call);
    await recordCall(session.id, record);
    return NextResponse.json({
      view: buildResultView({ ...session, call: record }),
      terminal: isTerminal(record.status),
    });
  } catch (error) {
    // A transient poll failure must not destroy a call in flight — serve the
    // last known state and let the next tick try again.
    const message = error instanceof Error ? error.message : "Poll failed.";
    return NextResponse.json({ view: buildResultView(session), pollError: message });
  }
}

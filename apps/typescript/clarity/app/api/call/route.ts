import { NextResponse } from "next/server";
import { z } from "zod";
import { operatorId, requireOperator } from "@/lib/auth";
import { callError, ownedSession, startLiveCall } from "@/lib/live-call";
import { isReplayMode, loadReplayRun } from "@/lib/replay";
import { recordCall } from "@/lib/session";

export const runtime = "nodejs";
const CallRequestSchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const parsed = CallRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid sessionId is required; destination overrides are forbidden." }, { status: 400 });
  try {
    const session = await ownedSession(parsed.data.sessionId, operatorId());
    if (session.callId) return NextResponse.json({ callId: session.callId, alreadyPlaced: true });
    if (session.replay) {
      const { record, synthetic } = await loadReplayRun();
      await recordCall(session.id, { ...record, createdAt: new Date().toISOString() });
      return NextResponse.json({ callId: record.callId, status: "queued", replay: true, synthetic });
    }
    if (isReplayMode()) return NextResponse.json({ error: "Live calling is disabled." }, { status: 403 });
    return NextResponse.json(await startLiveCall(session.id, operatorId()));
  } catch (error) {
    const { status, ...body } = callError(error);
    return NextResponse.json(body, { status });
  }
}

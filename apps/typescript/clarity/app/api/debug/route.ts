import { requireOperator } from "@/lib/auth";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { loadDemoApplication, loadDemoRun } from "@/lib/replay";
import { buildResultView } from "@/lib/result";
import type { CallRecord, Session } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The `?debug=1` back end.
 *
 * Serves the hand-authored demo run through `normalizeCall` → `buildResultView`,
 * the same two functions a live CALL-E response passes through, so the debug UI
 * exercises the production render path rather than a parallel fake one. Nothing
 * here reaches CALL-E or Gemini, which is the whole point: UI iteration should
 * not cost a call.
 *
 * Debug mode walks the same three stages as production and only ever differs
 * in where the call state comes from.
 *
 *   ?stage=clarify     the ranked claims, ready to dial
 *   ?stage=call        the call as just placed — nothing advances on its own
 *   ?stage=complete    the finished call and its structured result
 *   &outcome=failed    the same stage, but as a call that never connected
 */
export async function GET(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const stage = searchParams.get("stage") ?? "complete";
  const sessionId = searchParams.get("sessionId");

  try {
    const [application, demo] = await Promise.all([loadDemoApplication(), loadDemoRun()]);

    // Carry the session across the two stages, so a debug run is one session
    // from clarifications to result, the same way a real call is.
    const session: Session = {
      id: sessionId || randomUUID(),
      createdAt: new Date().toISOString(),
      replay: true,
      synthetic: demo.synthetic,
      application,
      clarifications: demo.clarifications,
      callId: null,
      call: null,
    };

    const base = { application, clarifications: demo.clarifications, sessionId: session.id };

    if (stage === "clarify" || stage === "questions") {
      return NextResponse.json({ ...base, stage: "clarify", view: null });
    }

    // The call as it looks the instant it is placed — queued, nothing said
    // yet — which is the state the screen is actually reached in. A snapshot
    // from the middle of the conversation would contradict the click that got
    // you here. It is the same shape a live poll returns, and it does not move.
    if (stage === "call" || stage === "calling") {
      const record: CallRecord = {
        ...demo.record,
        status: "queued",
        attemptStatus: "queued",
        transcript: [],
        summary: null,
        taskCompleted: null,
        completionConfidence: null,
        taskEvidence: [],
        structuredResult: null,
        completedAt: null,
      };
      const view = buildResultView({ ...session, callId: record.callId, call: record });
      return NextResponse.json({ ...base, stage: "calling", view, record });
    }

    if (stage === "complete" || stage === "result") {
      // A call that never connected is a result state too, and it is the one
      // state that cannot be reached by rehearsing a good run. `?fail=1` serves
      // the shape CALL-E actually returned for a declined call, so the failure
      // screen can be iterated on without waiting for a carrier to block one.
      const record: CallRecord =
        searchParams.get("outcome") === "failed"
          ? {
              ...demo.record,
              status: "failed",
              attemptStatus: "failed",
              transcript: [],
              summary:
                "The first call did not connect or complete; the recipient may be busy or unavailable.",
              taskCompleted: false,
              completionConfidence: null,
              taskEvidence: ["The call ended immediately with no conversation captured."],
              structuredResult: null,
              failureCode: "603",
              failureMessage: "calling task status=DECLINED (Hangup by: user)",
            }
          : demo.record;

      const view = buildResultView({ ...session, callId: record.callId, call: record });
      return NextResponse.json({ ...base, stage: "result", view, record });
    }

    return NextResponse.json({ ...base, stage: "compose", view: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debug fixture load failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

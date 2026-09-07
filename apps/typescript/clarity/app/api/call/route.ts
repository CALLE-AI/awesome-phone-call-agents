import { NextResponse } from "next/server";
import { z } from "zod";
import { buildResultSchema, buildTask, calleClient } from "@/lib/calle";
import { normalizeCall } from "@/lib/call-record";
import { findPhone } from "@/lib/phone";
import { loadReplayRun } from "@/lib/replay";
import { primaryClarification } from "@/lib/result";
import { getSession, recordCall } from "@/lib/session";

export const runtime = "nodejs";

const CallRequestSchema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = CallRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid sessionId is required." }, { status: 400 });
  }
  const session = await getSession(parsed.data.sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unknown session." }, { status: 404 });
  }

  if (session.callId) {
    return NextResponse.json({ callId: session.callId, alreadyPlaced: true });
  }

  // Replay spends no credits and dials nobody: it replays a captured run
  // through the same normalization boundary a live call crosses.
  if (session.replay) {
    try {
      const { record, synthetic } = await loadReplayRun();
      const replayed = { ...record, createdAt: new Date().toISOString() };
      await recordCall(session.id, replayed);
      return NextResponse.json({ callId: replayed.callId, status: "queued", replay: true, synthetic });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Replay failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Resolve from the submitted text again, so older sessions cannot carry a
  // demo fallback into a live call. Browser-supplied phone overrides are ignored.
  const phone = findPhone(session.application.resume, session.application.answers);

  if (!phone) {
    return NextResponse.json(
      {
        error:
          "No phone number was found in this application, so there is nobody to call. Add the candidate's number to the resume and analyze it again.",
      },
      { status: 400 },
    );
  }

  // One call, one ambiguity. The analyzer ranks what it finds, and the top of
  // that ranking is what gets asked — a call that works through a list is a
  // phone interview, and the thing worth demonstrating is the follow-up that
  // could only have been chosen after hearing the first answer.
  const clarification = primaryClarification(session);
  if (!clarification) {
    return NextResponse.json({ error: "This session has nothing to clarify." }, { status: 400 });
  }

  try {
    const client = calleClient();
    const call = await client.calls.create(
      {
        task: buildTask(clarification, {
          candidateName: session.application.candidateName,
          roleTitle: session.application.roleTitle,
        }),
        recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
        resultSchema: buildResultSchema(clarification),
        metadata: { app: "clarity", session_id: session.id },
        ...(process.env.CALLE_WEBHOOK_URL ? { webhookUrl: process.env.CALLE_WEBHOOK_URL } : {}),
      },
      // Durable: one session places at most one call, even across retries.
      { idempotencyKey: `clarity:${session.id}` },
    );

    const record = normalizeCall(call);
    await recordCall(session.id, record);

    return NextResponse.json({ callId: record.callId, status: record.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not place the call.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

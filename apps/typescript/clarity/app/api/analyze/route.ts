import { NextResponse } from "next/server";
import { z } from "zod";
import { analyze } from "@/lib/analyze";
import { operatorId, requireOperator } from "@/lib/auth";
import { isReplayMode, loadReplayRun } from "@/lib/replay";
import { createSession } from "@/lib/session";
import type { ApplicationInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const ApplicationSchema = z.object({
  jobDescription: z.string().trim().default(""),
  resume: z.string().trim().default(""),
  answers: z.string().trim().default(""),
  candidateName: z.string().trim().optional(),
  roleTitle: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Application fields must be text." }, { status: 400 });
  }
  const application: ApplicationInput = parsed.data;

  if (!application.jobDescription || (!application.resume && !application.answers)) {
    return NextResponse.json(
      { error: "A job description plus a resume or written answers is required." },
      { status: 400 },
    );
  }

  // Replay rehearses the UI without spending anything. The fixture carries the
  // clarifications that produced its call, so the result cards stay keyed to the
  // run they came from rather than to a fresh, unrelated analysis.
  if (isReplayMode()) {
    try {
      const { clarifications, synthetic } = await loadReplayRun();
      const session = await createSession({ ownerId: operatorId(), application, clarifications, replay: true, synthetic });
      return NextResponse.json({
        sessionId: session.id,
        clarifications,
        rejected: [],
        replay: true,
        candidatePhone: null,
      });
    } catch {
      const message = "Replay failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set. Add it to .env and restart." },
      { status: 500 },
    );
  }

  try {
    const result = await analyze(application);

    if (result.clarifications.length === 0) {
      return NextResponse.json(
        {
          error:
            "No claim in this application could be anchored to a verbatim span. Try a fuller application.",
          rejected: result.rejected,
        },
        { status: 422 },
      );
    }

    const session = await createSession({ ownerId: operatorId(), application, clarifications: result.clarifications });

    return NextResponse.json({
      sessionId: session.id,
      clarifications: result.clarifications,
      rejected: result.rejected,
      candidatePhone: null,
    });
  } catch {
    const message = "Analysis failed. Check the server configuration and try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

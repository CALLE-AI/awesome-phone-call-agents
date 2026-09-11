import { NextResponse } from "next/server";

import { CalleApiError, CalleConfigError } from "@/lib/calle";
import { getBatch, setCallDecision } from "@/lib/db";
import { queueReadyCalls, startCandidateCall } from "@/lib/place-call";
import { publicPayload } from "@/lib/public-payload";
import type { RecruiterDecision } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    candidateId?: string;
    allReady?: boolean;
  };

  try {
    if (body.allReady) {
      const summary = await queueReadyCalls(id);
      const detail = await getBatch(id);
      return NextResponse.json(publicPayload({ ...summary, ...detail }));
    }
    if (!body.candidateId) {
      return NextResponse.json({ error: "Choose a candidate to call." }, { status: 400 });
    }
    await startCandidateCall(id, body.candidateId);
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload({ queued: 1, ...detail }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not place the call.";
    const status =
      error instanceof CalleConfigError
        ? 400
        : error instanceof CalleApiError && error.status
          ? error.status
          : message.includes("not found")
            ? 404
            : 400;
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload({ error: message, ...detail }), { status });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    candidateId?: string;
    decision?: RecruiterDecision;
  };
  const allowed: RecruiterDecision[] = ["call_again", "next_round", "rejected", ""];
  if (!body.candidateId) {
    return NextResponse.json({ error: "Choose a candidate." }, { status: 400 });
  }
  if (typeof body.decision !== "string" || !allowed.includes(body.decision)) {
    return NextResponse.json({ error: "Choose Call again, Next round, or Rejected." }, { status: 400 });
  }

  try {
    await setCallDecision(id, body.candidateId, body.decision);
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload(detail));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save that decision.";
    const status = message.includes("not found") ? 404 : 400;
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload({ error: message, ...detail }), { status });
  }
}

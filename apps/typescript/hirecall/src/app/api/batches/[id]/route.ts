import { NextResponse } from "next/server";

import { liveCallsEnabled } from "@/lib/calle";
import { getBatch, setBatchActive, setBatchJobRole, setBatchScoreConfig, setBatchSystemPrompt } from "@/lib/db";
import { publicPayload } from "@/lib/public-payload";
import { parseScoreConfig } from "@/lib/score-config";
import { ensureBatchSummaries, syncBatchCalls } from "@/lib/place-call";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await syncBatchCalls(id);
    await ensureBatchSummaries(id);
  } catch {
    // Keep the stored batch even if CALL-E poll or Gemini summary fails.
  }
  const detail = await getBatch(id);
  if (!detail) {
    return NextResponse.json({ error: "That Excel batch was not found." }, { status: 404 });
  }
  return NextResponse.json(publicPayload({ ...detail, liveCallsEnabled: liveCallsEnabled() }));
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    active?: boolean;
    jobRole?: string;
    systemPrompt?: string;
    scoreCriteria?: unknown;
  };
  if (
    typeof body.active !== "boolean" &&
    typeof body.jobRole !== "string" &&
    typeof body.systemPrompt !== "string" &&
    body.scoreCriteria === undefined
  ) {
    return NextResponse.json({ error: "Set active, jobRole, systemPrompt, or scoreCriteria." }, { status: 400 });
  }

  try {
    if (body.scoreCriteria !== undefined) {
      await setBatchScoreConfig(id, parseScoreConfig(body.scoreCriteria));
    }
    if (typeof body.systemPrompt === "string") {
      await setBatchSystemPrompt(id, body.systemPrompt);
    }
    if (typeof body.jobRole === "string") {
      await setBatchJobRole(id, body.jobRole);
    }
    if (typeof body.active === "boolean") {
      const updated = await setBatchActive(id, body.active);
      if (!updated) {
        return NextResponse.json({ error: "That Excel batch was not found." }, { status: 404 });
      }
    }
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload(detail));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update this batch.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const updated = await setBatchActive(id, false);
  if (!updated) {
    return NextResponse.json({ error: "That Excel batch was not found." }, { status: 404 });
  }
  return NextResponse.json({ removed: true, active: false });
}

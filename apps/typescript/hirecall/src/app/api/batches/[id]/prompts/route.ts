import { NextResponse } from "next/server";

import { getBatch, prepareBatchPrompts, prepareCandidatePrompt } from "@/lib/db";
import { publicPayload } from "@/lib/public-payload";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    candidateId?: string;
    allPending?: boolean;
  };

  try {
    if (body.allPending) {
      const summary = await prepareBatchPrompts(id);
      const detail = await getBatch(id);
      return NextResponse.json(publicPayload({ ...summary, ...detail }));
    }
    if (!body.candidateId) {
      return NextResponse.json({ error: "Choose a candidate to write a prompt." }, { status: 400 });
    }
    const result = await prepareCandidatePrompt(id, body.candidateId);
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload({ promptSource: result.source, ...detail }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not write the call prompt.";
    const status = message.includes("not found") ? 404 : 400;
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload({ error: message, ...detail }), { status });
  }
}

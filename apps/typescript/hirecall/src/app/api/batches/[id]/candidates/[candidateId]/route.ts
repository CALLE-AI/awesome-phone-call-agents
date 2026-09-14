import { NextResponse } from "next/server";

import { getBatch, updateCandidate } from "@/lib/db";
import { publicPayload } from "@/lib/public-payload";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; candidateId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id, candidateId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    phone?: string;
    resumeUrl?: string;
    consent?: boolean;
    jobRole?: string;
  };

  try {
    await updateCandidate(id, candidateId, body);
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload(detail));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update this candidate.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

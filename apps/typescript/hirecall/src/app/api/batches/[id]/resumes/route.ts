import { NextResponse } from "next/server";

import { getBatch, prepareBatchResumes, prepareCandidateResume } from "@/lib/db";
import { publicPayload } from "@/lib/public-payload";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    candidateId?: string;
    allWithLinks?: boolean;
  };

  try {
    if (body.allWithLinks) {
      const summary = await prepareBatchResumes(id);
      const detail = await getBatch(id);
      return NextResponse.json(publicPayload({ ...summary, ...detail }));
    }
    if (!body.candidateId) {
      return NextResponse.json({ error: "Choose a candidate to prepare." }, { status: 400 });
    }
    await prepareCandidateResume(id, body.candidateId);
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload(detail));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the resume.";
    const status = message.includes("not found") ? 404 : 400;
    const detail = await getBatch(id);
    return NextResponse.json(publicPayload({ error: message, ...detail }), { status });
  }
}

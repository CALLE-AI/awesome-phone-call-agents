import { NextResponse } from "next/server";
import { loadDemoApplication } from "@/lib/replay";

export const runtime = "nodejs";

/**
 * The Load example button. Serving the fixture from the server keeps a single
 * source of truth for the seeded application — the same file the scripts and
 * debug mode read.
 */
export async function GET() {
  const demo = await loadDemoApplication();
  return NextResponse.json({
    jobDescription: demo.jobDescription,
    resume: demo.resume,
    answers: demo.answers,
    candidateName: demo.candidateName,
    roleTitle: demo.roleTitle,
  });
}

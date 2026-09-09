import { NextResponse } from "next/server";
import { executeCallRun } from "@/lib/run-call";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const caseId = typeof rec.caseId === "string" ? rec.caseId : "";
  const mode = rec.mode === "live" ? "live" : rec.mode === "demo" ? "demo" : "";
  if (!caseId || !mode) {
    return NextResponse.json({ error: "caseId and mode required" }, { status: 400 });
  }
  const url = new URL(req.url);
  const result = await executeCallRun({
    caseId,
    mode,
    confirmLive: typeof rec.confirmLive === "string" ? rec.confirmLive : undefined,
    fast: url.searchParams.get("fast") === "1",
  });
  return NextResponse.json(result.body, { status: result.status });
}

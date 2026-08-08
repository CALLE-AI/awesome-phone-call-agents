import { CalleClient } from "@call-e/calle";
import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { confidenceNumber, memoryResultValidator } from "../../../../lib/callbacks";

const terminal = new Set(["completed", "failed", "cancelled", "canceled", "no_answer", "busy", "declined", "expired", "voicemail"]);

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again to read call status." }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ message: "Missing callback id." }, { status: 400 });
    const supabase = adminSupabase();
    const { data: session } = await supabase.from("call_sessions").select("*").eq("id", id).eq("requested_by", user.id).single();
    if (!session) return NextResponse.json({ message: "Callback not found." }, { status: 404 });
    if (session.provider === "demo" || terminal.has(session.status)) return NextResponse.json({ previewId: session.id, status: session.status, summary: session.result?.summary ?? null });
    if (!session.provider_call_id || !process.env.CALLE_API_KEY) return NextResponse.json({ message: "CALL-E status is unavailable." }, { status: 503 });
    const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY, baseUrl: "https://api.heycall-e.com" });
    const call = await client.calls.get(session.provider_call_id);
    const update: Record<string, unknown> = { status: call.status, result: { summary: call.summary, taskCompleted: call.taskCompleted, confidence: call.completionConfidence, evidence: call.evidence } };
    let inserted = 0;
    if (terminal.has(call.status)) {
      update.completed_at = call.completedAt ?? new Date().toISOString();
      const result = memoryResultValidator.safeParse(call.recipients[0]?.structuredResult);
      const score = call.completionConfidence?.score ?? 0;
      if (call.status === "completed" && call.taskCompleted === true && score >= 0.6 && result.success && result.data.outcome !== "no_usable_evidence") {
        const payload = result.data.memory_items.filter((item) => item.confidence !== "low" && item.confidence !== "unknown").map((item) => ({ ...item, confidence: confidenceNumber(item.confidence) }));
        const { data } = await supabase.rpc("ingest_call_memory", { target_session: session.id, memory_payload: payload });
        inserted = Number(data ?? 0);
      }
    }
    await supabase.from("call_sessions").update(update).eq("id", session.id);
    return NextResponse.json({ previewId: session.id, status: call.status, summary: call.summary, taskCompleted: call.taskCompleted, confidence: call.completionConfidence, memoryItemsCreated: inserted });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not read CALL-E status." }, { status: 502 });
  }
}

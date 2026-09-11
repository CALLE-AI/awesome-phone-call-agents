import { CalleClient } from "@call-e/calle";
import { NextResponse } from "next/server";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import { fingerprint, memoryResultValidator } from "../../../../lib/callbacks";
import { admittedMemoryItems, fingerprintInput, providerMetadataMatches, providerSessionMatches, recipientTranscriptEvidence, reviewedProviderPhone, storedPreviewCore, storedPreviewSchema } from "../../../../lib/call-safety";

const terminal = new Set(["completed", "failed", "cancelled", "canceled", "no_answer", "busy", "declined", "expired", "voicemail"]);

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again to read call status." }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ message: "Missing callback id." }, { status: 400 });

    const supabase = adminSupabase();
    const { data: session } = await supabase.from("call_sessions").select("*").eq("id", id).eq("requested_by", user.id).maybeSingle();
    if (!session) return NextResponse.json({ message: "Callback not found." }, { status: 404 });
    const { data: caller } = await supabase.from("company_members").select("id").eq("company_id", session.company_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (!caller) return NextResponse.json({ message: "You are no longer an active member of this company." }, { status: 403 });

    if (session.provider === "demo" || terminal.has(session.status)) {
      return NextResponse.json({ previewId: session.id, status: session.status, summary: session.result?.summary ?? null });
    }
    if (session.status === "dispatching" && !session.provider_call_id) {
      return NextResponse.json({ message: "The provider create result is still ambiguous. Confirm the same preview again to reconcile its stable idempotency key.", previewId: session.id, status: session.status }, { status: 409 });
    }
    if (!session.provider_call_id || !process.env.CALLE_API_KEY) return NextResponse.json({ message: "CALL-E status is unavailable." }, { status: 503 });

    const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY, baseUrl: "https://api.heycall-e.com" });
    const call = await client.calls.get(session.provider_call_id);
    const parsedPreview = storedPreviewSchema.safeParse(session.preview);
    const providerRecipient = call.recipients?.[0];
    if (!parsedPreview.success || !providerRecipient || call.recipients.length !== 1) {
      return NextResponse.json({ message: "CALL-E returned a result that does not match the reviewed callback." }, { status: 409 });
    }
    const preview = parsedPreview.data;
    const metadataMatches = providerMetadataMatches(preview.metadata, call.metadata ?? {});
    const sessionMatches = providerSessionMatches(preview, session, call);
    const providerPhone = reviewedProviderPhone(preview.recipient, providerRecipient);
    if (!providerPhone) return NextResponse.json({ message: "CALL-E returned a recipient that differs from the approved preview. Memory ingestion was blocked." }, { status: 409 });
    const providerFingerprint = await fingerprint(fingerprintInput(storedPreviewCore(preview), providerPhone));
    if (!metadataMatches || !sessionMatches || providerFingerprint !== session.payload_fingerprint) {
      return NextResponse.json({ message: "CALL-E returned a session, task, metadata, or recipient that differs from the approved preview. Memory ingestion was blocked." }, { status: 409 });
    }
    const transcriptEvidence = recipientTranscriptEvidence(call.recipients);
    const update: Record<string, unknown> = {
      status: call.status,
      result: { taskCompleted: call.taskCompleted, confidenceScore: call.completionConfidence?.score ?? null },
    };
    let inserted = 0;
    if (terminal.has(call.status)) {
      update.completed_at = call.completedAt ?? new Date().toISOString();
      const result = memoryResultValidator.safeParse((call.recipients ?? [])[0]?.structuredResult);
      const score = call.completionConfidence?.score ?? 0;
      const accepted = call.status === "completed" && call.taskCompleted === true && score >= 0.75 && result.success && result.data.outcome === "complete";
      if (accepted) {
        const payload = admittedMemoryItems(result.data, transcriptEvidence);
        if (payload.length > 0) {
          const { data, error } = await supabase.rpc("ingest_call_memory", { target_session: session.id, target_user: user.id, memory_payload: payload });
          if (error) throw error;
          inserted = Number(data ?? 0);
        }
        if (session.mode === "catchup") {
          const { error: briefingError } = await supabase.from("company_members").update({ last_briefed_version: preview.contextVersion }).eq("id", session.member_id).eq("company_id", session.company_id);
          if (briefingError) throw briefingError;
        }
      }
      update.result = { taskCompleted: call.taskCompleted, confidenceScore: score, outcome: result.success ? result.data.outcome : "invalid", memoryItemsCreated: inserted };
    }
    const { error: updateError } = await supabase.from("call_sessions").update(update).eq("id", session.id);
    if (updateError) throw updateError;
    return NextResponse.json({ previewId: session.id, status: call.status, summary: call.summary, taskCompleted: call.taskCompleted, confidence: call.completionConfidence, memoryItemsCreated: inserted });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not read CALL-E status." }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { LeadDossier, TranscriptEntry } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const { callId, status, transcript, extractedIntelligence, recordingUrl, speedToDialSec, durationSec } = payload;

    if (!callId) {
      return NextResponse.json({ success: false, message: "callId is required" }, { status: 400 });
    }

    const existing = db.getCall(callId);
    if (!existing) {
      return NextResponse.json({ success: false, message: "Call not found" }, { status: 404 });
    }

    existing.status = status || "completed";
    existing.endedAt = new Date().toISOString();
    if (speedToDialSec) existing.speedToDialSec = speedToDialSec;
    if (durationSec) existing.durationSec = durationSec;
    if (recordingUrl) existing.recordingUrl = recordingUrl;

    if (transcript && Array.isArray(transcript)) {
      existing.transcript = transcript;
      existing.fullTranscript = transcript.map((t: TranscriptEntry) => `[${t.speaker.toUpperCase()}]: ${t.text}`).join("\n\n");
    }

    if (extractedIntelligence) {
      const dossier: LeadDossier = {
        id: `lead_${Date.now().toString(36)}`,
        callId,
        warmthScore: extractedIntelligence.warmthScore || 9.0,
        intentTier: extractedIntelligence.intentTier || "hot",
        triggerPain: extractedIntelligence.triggerPain || "Not specified",
        scopeRequirement: extractedIntelligence.scopeRequirement || "Not specified",
        urgencyTimeline: extractedIntelligence.urgencyTimeline || "Not specified",
        estimatedBudget: extractedIntelligence.estimatedBudget || "Not specified",
        decisionAuthority: extractedIntelligence.decisionAuthority || "Not specified",
        nextStep: extractedIntelligence.nextStep || "Follow-up required",
        crmSynced: true,
        createdAt: new Date().toISOString()
      };
      existing.leadDossier = dossier;
    }

    db.saveCall(existing);

    return NextResponse.json({ success: true, message: "Webhook processed successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Webhook processing error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

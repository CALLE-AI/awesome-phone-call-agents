import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { listMissions, saveMission } from "@/lib/store";
import { normalizeSdkResult } from "@/services/calle/calleClient";
import { extractResult } from "@/lib/extractor";

export const dynamic = "force-dynamic";

// In-memory dedup for at-least-once delivery. Missions also persist the
// event id in their event log, so restarts stay duplicate-safe.
const seen = new Set<string>();

function findCallId(body: Record<string, unknown>): string | null {
  const direct = body["call_id"] ?? body["callId"] ?? body["id"];
  if (typeof direct === "string" && direct) return direct;
  const data = body["data"];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const nested = d["call_id"] ?? d["callId"] ?? d["id"];
    if (typeof nested === "string" && nested) return nested;
  }
  return null;
}

/**
 * CALL-E terminal webhook. CALL-E sends terminal events only, after the
 * post-call outcome and structured results are finalized.
 * Delivery is at-least-once: deduplicate on the `CALL-E-Event-Id` header.
 * Configure with CALLE_WEBHOOK_URL=https://<host>/api/calle/webhook
 */
export async function POST(req: NextRequest) {
  const eventId = req.headers.get("calle-event-id") ?? req.headers.get("x-calle-event-id");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if (eventId && seen.has(eventId)) return NextResponse.json({ ok: true, deduplicated: true });
  const missions = await listMissions();
  if (eventId && missions.some((m) => m.events.some((e) => (e.meta as Record<string, unknown> | undefined)?.["webhookEventId"] === eventId))) {
    seen.add(eventId);
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  const callId = findCallId(body);
  const mission = callId ? missions.find((m) => m.callId === callId) ?? null : null;
  if (!mission) {
    // Unknown call — acknowledge so CALL-E stops retrying, but say so honestly.
    return NextResponse.json({ ok: true, reconciled: false, reason: "No mission matches this call id" });
  }

  const snap = normalizeSdkResult({ id: callId, status: "completed", ...body });
  mission.events.push({
    id: randomUUID(), missionId: mission.id, ts: new Date().toISOString(),
    kind: "webhook", message: "CALL-E terminal webhook received", meta: { webhookEventId: eventId ?? null, status: snap.status },
  });
  if (mission.status !== "completed") {
    mission.result = extractResult(mission, snap);
    mission.status = snap.status === "completed" || mission.result.objective_achieved ? "completed" : "needs_review";
    mission.events.push({
      id: randomUUID(), missionId: mission.id, ts: new Date().toISOString(),
      kind: "result", message: "Structured result finalized from webhook", meta: { webhookEventId: eventId ?? null },
    });
  }
  mission.updatedAt = new Date().toISOString();
  if (eventId) seen.add(eventId);
  await saveMission(mission);
  return NextResponse.json({ ok: true, reconciled: true, missionId: mission.id, status: mission.status });
}

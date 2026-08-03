import { NextRequest, NextResponse } from "next/server";
import { getUsableCalleSession } from "@/lib/auth";
import { getCallHistory, saveCallRecord, clearCallHistory, type StoredCallRecord } from "@/lib/call-history";
import { getWebhookUrl, fireWebhook, type WebhookPayload } from "@/lib/webhooks";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestId, logError } from "@/lib/observability";

// GET /api/calls/history — load persisted call records for the current user
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit(req, "calls-history-get", 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ records: [] });

  try {
    const records = await getCallHistory(session.email);
    return NextResponse.json({ records });
  } catch (err) {
    logError("Failed to load call history", err, { route: "/api/calls/history" });
    return NextResponse.json({ records: [] });
  }
}

// POST /api/calls/history — save a terminal call record + fire webhook if configured
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const rl = await checkRateLimit(req, "calls-history-post", 120, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ ok: true }); // no-op without email key

  let record: StoredCallRecord;
  try {
    record = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!record?.id || !record?.phase || !["completed", "failed"].includes(record.phase)) {
    return NextResponse.json({ error: "Invalid record" }, { status: 422 });
  }

  try {
    await saveCallRecord(session.email, record);
  } catch (err) {
    logError("Failed to save call record", err, { route: "/api/calls/history", requestId });
    // Non-fatal — don't fail the request
  }

  // Fire webhook asynchronously (non-blocking)
  try {
    const webhookUrl = await getWebhookUrl(session.email);
    if (webhookUrl) {
      const payload: WebhookPayload = {
        event: record.phase === "completed" ? "call.completed" : "call.failed",
        call_id: record.id,
        run_id: record.run_id,
        phone_masked: record.phone.replace(/\d(?=\d{2})/g, "*"),
        goal: record.goal,
        outcome: record.outcome
          ? {
              task_completed: record.outcome.task_completed,
              confidence_label: record.outcome.completion_confidence.label,
              confidence_score: record.outcome.completion_confidence.score,
            }
          : null,
        post_summary: record.post_summary ?? null,
        timestamp: new Date().toISOString(),
      };
      // Fire without awaiting to keep response fast
      void fireWebhook(webhookUrl, payload);
    }
  } catch { /* ignore webhook errors */ }

  return NextResponse.json({ ok: true });
}

// DELETE /api/calls/history — clear all history for the current user
export async function DELETE(req: NextRequest) {
  const rl = await checkRateLimit(req, "calls-history-delete", 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  const session = await getUsableCalleSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.email) return NextResponse.json({ ok: true });

  await clearCallHistory(session.email);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";

import { parseWebhookEvent, WebhookInputError } from "@/lib/calle/webhook-event";
import { hasValidWebhookToken } from "@/lib/calle/webhook-url";
import { recordWebhookEvent } from "@/lib/db/call-lifecycle";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 512_000;

export async function POST(request: Request) {
  if (!hasValidWebhookToken(request.url)) {
    return NextResponse.json({ error: "Webhook authorization failed" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  const advertisedLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook body is too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook body is too large" }, { status: 413 });
  }

  try {
    const body: unknown = JSON.parse(raw);
    const event = parseWebhookEvent(body, request.headers.get("call-e-event-id"));
    const outcome = await recordWebhookEvent(event);
    return NextResponse.json({ ok: true, duplicate: outcome === "duplicate" });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof WebhookInputError) {
      return NextResponse.json(
        { error: error instanceof WebhookInputError ? error.message : "Webhook body is invalid JSON" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Webhook could not be processed" }, { status: 409 });
  }
}

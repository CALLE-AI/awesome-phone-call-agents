import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkEventRateLimit } from "@/lib/calle/security";
import { authenticateSdkRequest } from "@/lib/sdk/auth";
import type { EventIngestRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rate = checkEventRateLimit(ip);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Event rate limit exceeded." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as EventIngestRequest;
    const auth = authenticateSdkRequest(req.headers, body.accountId);
    if (!auth.ok) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status });
    }
    const accountId = auth.accountId;
    const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const events = Array.isArray(body.events) ? body.events : [];

    if (!accountId || !visitorId || !sessionId) {
      return NextResponse.json(
        { success: false, message: "accountId, visitorId, and sessionId are required." },
        { status: 400 }
      );
    }
    if (events.length === 0) {
      return NextResponse.json({ success: true, accepted: 0 });
    }
    if (events.length > 50) {
      return NextResponse.json(
        { success: false, message: "Maximum 50 events per batch." },
        { status: 400 }
      );
    }

    const accepted = db.ingestEventBatch({
      accountId,
      visitorId,
      sessionId,
      events: events
        .filter((item) => item && typeof item.event === "string" && item.event.trim())
        .map((item) => ({
          event: item.event.trim().slice(0, 80),
          properties: item.properties && typeof item.properties === "object" ? item.properties : {},
          timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined
        }))
    });

    return NextResponse.json({ success: true, accepted }, { status: 202 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

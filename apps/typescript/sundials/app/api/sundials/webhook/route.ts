import { NextRequest, NextResponse } from "next/server";
import { db, toPublicCall } from "@/lib/db";
import { checkRateLimit } from "@/lib/calle/security";
import { ingestCalleWebhook } from "@/lib/calle/webhook";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded. Please try again in 1 minute." },
        { status: 429 }
      );
    }

    const payload: unknown = await req.json();
    const result = await ingestCalleWebhook(db, payload);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    return NextResponse.json({ success: true, call: toPublicCall(result.call) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Webhook processing error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

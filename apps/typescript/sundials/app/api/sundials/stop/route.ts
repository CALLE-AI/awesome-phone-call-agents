import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compactE164, validatePhoneNumber } from "@/lib/calle/security";
import { authenticateSdkRequest } from "@/lib/sdk/auth";
import { stopFollowUpsForVisitor } from "@/lib/calle/retry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      accountId?: string;
      visitorId?: string;
      phoneNumber?: string;
    };
    const auth = authenticateSdkRequest(req.headers, body.accountId);
    if (!auth.ok) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status });
    }

    const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";
    const phoneNumber = typeof body.phoneNumber === "string" ? compactE164(body.phoneNumber) : "";
    if (!visitorId) {
      return NextResponse.json({ success: false, message: "visitorId is required." }, { status: 400 });
    }
    const phoneCheck = validatePhoneNumber(phoneNumber);
    if (!phoneCheck.valid) {
      return NextResponse.json(
        { success: false, message: phoneCheck.error || "Invalid phone number." },
        { status: 400 }
      );
    }

    const cancelled = stopFollowUpsForVisitor(db, visitorId, phoneNumber);
    return NextResponse.json({ success: true, cancelled });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

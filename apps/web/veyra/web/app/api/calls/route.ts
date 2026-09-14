import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { assertLiveOperatorUser } from "@/lib/auth/live-access";
import { LiveAccessError } from "@/lib/auth/live-policy";
import {
  CallConfigurationError,
  executeApprovedCall,
  getCallMode,
} from "@/lib/calle/client";
import { CallHttpError, readCallJson } from "@/lib/calle/http";
import {
  createCallPreview,
  parseApprovedCallRequest,
  SafeCallInputError,
} from "@/lib/calle/safety";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await readCallJson(request);
    const approved = parseApprovedCallRequest(body);
    const { approval, ...draft } = approved;
    const mode = getCallMode();
    await assertLiveOperatorUser(auth.user.id, mode);
    const preview = await createCallPreview(auth.user.id, draft, mode);

    if (!sameDigest(approval.approvalDigest, preview.approvalDigest)) {
      return NextResponse.json(
        { error: "The call changed after approval; generate and approve a new preview" },
        { status: 409 },
      );
    }
    if (preview.recipientAuthorizationRequired && !approval.recipientAuthorizationConfirmed) {
      return NextResponse.json(
        { error: "Live mode requires confirmation that the recipient authorized this exact call" },
        { status: 400 },
      );
    }

    const execution = await executeApprovedCall(draft, preview);
    return NextResponse.json(
      {
        execution,
        preview: {
          mode: preview.mode,
          maskedPhone: preview.maskedPhone,
          callCount: preview.callCount,
        },
      },
      { status: execution.mode === "live" ? 202 : 200 },
    );
  } catch (error) {
    if (error instanceof CallHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SafeCallInputError) {
      return NextResponse.json(
        { error: "Call request is invalid", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof CallConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof LiveAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    // Provider errors can contain recipient or task context. Do not echo or log them here.
    return NextResponse.json(
      { error: "CALL-E did not accept the call; do not retry with a new approval" },
      { status: 502 },
    );
  }
}

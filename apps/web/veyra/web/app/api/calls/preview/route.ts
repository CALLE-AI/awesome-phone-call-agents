import { NextResponse } from "next/server";

import { assertLiveOperatorUser } from "@/lib/auth/live-access";
import { LiveAccessError } from "@/lib/auth/live-policy";
import { getCallMode, CallConfigurationError } from "@/lib/calle/client";
import { CallHttpError, readCallJson } from "@/lib/calle/http";
import {
  createCallPreview,
  parseCallDraft,
  SafeCallInputError,
} from "@/lib/calle/safety";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await readCallJson(request);
    const draft = parseCallDraft(body);
    const mode = getCallMode();
    await assertLiveOperatorUser(auth.user.id, mode);
    const preview = await createCallPreview(auth.user.id, draft, mode);
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof CallHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SafeCallInputError) {
      return NextResponse.json(
        { error: "Call preview is invalid", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof CallConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof LiveAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

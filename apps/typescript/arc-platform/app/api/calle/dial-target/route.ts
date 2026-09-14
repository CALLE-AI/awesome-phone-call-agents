import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { calleConfigured, resolvePhone, isE164, demoFallbackActive } from "@/lib/calle";

/**
 * What number would a call dial right now, and where does it come from?
 *
 * This exists because four calls in a row went to a number nobody expected and
 * it took CALL-E's dashboard to notice. `resolvePhone` was behaving correctly
 * the whole time - a typed number beats the env fallback - but the UI said
 * only "the server's demo number" and never which one.
 *
 * Deliberately NOT folded into /api/calle/health, which is in isPublicRoute:
 * a phone number should not be readable without signing in.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const typed = req.nextUrl.searchParams.get("phone") ?? "";
  const resolved = resolvePhone(typed);

  return NextResponse.json({
    resolved: resolved || null,
    source: typed.trim() ? "typed" : resolved ? "demo-env" : "none",
    valid: isE164(resolved),
    live: calleConfigured(),
    /* False in production: the user must supply a number, so the card asks
       for one rather than promising a fallback that will not happen. */
    fallbackActive: demoFallbackActive(),
  });
}

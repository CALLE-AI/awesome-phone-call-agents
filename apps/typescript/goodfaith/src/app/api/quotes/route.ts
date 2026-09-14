// File: src/app/api/quotes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createQuoteCall } from "@/lib/calle";
import { putRfq, newRfqId } from "@/lib/store";
import { isLive } from "@/lib/env";

export const runtime = "nodejs";

interface Body {
  procedure?: string;
  code?: string;
  zip?: string;
  clinics?: { name?: string; phone?: string }[];
}

function bad(msg: string) {
  return NextResponse.json({ data: null, error: msg }, { status: 400 });
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("invalid JSON body");
  }

  // Guard against non-object / null / array bodies and wrong-typed fields (fail with 400, never 500).
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return bad("body must be a JSON object");
  }

  const procedure = str(body.procedure).trim();
  const code = str(body.code, "72148").trim() || "72148";
  if (!procedure) return bad("procedure is required");

  const rawClinics: unknown = body.clinics;
  if (rawClinics !== undefined && !Array.isArray(rawClinics)) {
    return bad("clinics must be an array");
  }
  const clinics = ((rawClinics as unknown[]) ?? [])
    .filter((c) => c !== null && typeof c === "object")
    .map((c) => {
      const o = c as { name?: unknown; phone?: unknown };
      return { name: str(o.name).trim(), phone: str(o.phone).replace(/[^\d+]/g, "") };
    })
    .filter((c) => c.name.length > 0);
  if (clinics.length === 0) return bad("at least one clinic is required");
  if (clinics.length > 10) return bad("max 10 clinics per request");

  const rfqId = newRfqId(code);
  try {
    const { callId, mode, task } = await createQuoteCall({ procedure, code, clinics, rfqId });
    putRfq({
      rfqId,
      callId,
      mode,
      procedure,
      code,
      clinics,
      task,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ data: { rfq_id: rfqId, call_id: callId, mode }, error: null });
  } catch (e) {
    // Graceful degradation: never 500 the client into a crash.
    const msg = e instanceof Error ? e.message : "call creation failed";
    return NextResponse.json(
      { data: null, error: `CALL-E ${isLive() ? "live" : "mock"} call failed: ${msg}` },
      { status: 502 }
    );
  }
}

// File: src/app/api/quotes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createQuoteCall } from "@/lib/calle";
import { putRfq, newRfqId } from "@/lib/store";
import { env, isLive } from "@/lib/env";
import { isE164 } from "@/lib/normalize";

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

function forbidden(msg: string) {
  return NextResponse.json({ data: null, error: msg }, { status: 403 });
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

// Minimal dependency-free per-IP rate limit: 20 requests / 60s / IP, in-memory.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const g = globalThis as unknown as { __gf_rate?: Map<string, number[]> };
const rateHits: Map<string, number[]> = (g.__gf_rate ??= new Map());

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "unknown";
}

// Returns true when the caller is over the limit for the current window.
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (rateHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(ip, recent);
  return false;
}

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { data: null, error: "rate limit exceeded: max 20 requests per minute" },
      { status: 429 }
    );
  }

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

  // Every clinic must carry a valid E.164 phone. A name with an empty or garbage phone
  // is rejected so the endpoint can never be coaxed into dialing an arbitrary string.
  for (const c of clinics) {
    if (!isE164(c.phone)) {
      return bad(`clinic "${c.name}" has an invalid or missing E.164 phone`);
    }
  }

  // Reject duplicate destinations: two clinics resolving to the same phone.
  const seen = new Set<string>();
  for (const c of clinics) {
    if (seen.has(c.phone)) return bad(`duplicate recipient phone: ${c.phone}`);
    seen.add(c.phone);
  }

  // Live-dial authorization. Mock never dials, so it skips the allowlist (but still
  // enforced E.164 + dedupe above). In live mode: an empty allowlist refuses all live
  // dialing (safe by default); a non-empty allowlist admits only listed numbers.
  if (isLive()) {
    const allow = env.allowedRecipients();
    if (allow.length === 0) {
      return forbidden(
        "GOODFAITH_ALLOWED_RECIPIENTS must be configured for live calls"
      );
    }
    const allowSet = new Set(allow);
    for (const c of clinics) {
      if (!allowSet.has(c.phone)) {
        return forbidden(`recipient not authorized for live calls: ${c.phone}`);
      }
    }
  }

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

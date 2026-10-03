// File: src/lib/auth.ts
// Caller authorization for live-privileged endpoints. Mock mode is the public demo
// surface and stays open; live mode (real calls, real transcripts) requires a bearer token.
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { env, isLive } from "@/lib/env";

// Length-independent, constant-time-ish comparison so a wrong token cannot be probed by timing.
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let out = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    out |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return out === 0;
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

// Returns a 401 NextResponse when the caller is not authorized, or null when the request
// may proceed. In mock mode always proceeds. In live mode a token MUST be configured
// (fail-closed: an unconfigured server refuses live-privileged access) and must match.
export function requireCaller(req: NextRequest): NextResponse | null {
  if (!isLive()) return null; // public mock demo

  const configured = env.apiToken();
  if (!configured) {
    return NextResponse.json(
      { data: null, error: "server not configured for authorized live access" },
      { status: 401 }
    );
  }

  const got = bearer(req);
  if (!got || !safeEqual(got, configured)) {
    return NextResponse.json(
      { data: null, error: "caller authorization required" },
      { status: 401 }
    );
  }
  return null;
}

import { NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  opsRunSecret,
  safeEqual,
  sessionCookieHeader,
  signOpsSession,
} from "@/lib/ops-auth";

export function GET(req: Request) {
  const auth = authorizeOpsRequest(req);
  return NextResponse.json({ authorized: auth.ok });
}

export async function POST(req: Request) {
  const secret = opsRunSecret();
  if (!secret) {
    return NextResponse.json({ error: "operator auth not configured" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const offered = typeof rec.secret === "string" ? rec.secret : "";
  if (!offered || !safeEqual(offered, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const session = signOpsSession();
  const res = NextResponse.json({ authorized: true });
  res.headers.set("Set-Cookie", sessionCookieHeader(session.token, session.exp));
  return res;
}

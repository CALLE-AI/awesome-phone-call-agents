import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function secretMatches(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function operatorId(): string {
  return createHash("sha256").update(process.env.CLARITY_AUTH_TOKEN ?? "").digest("hex");
}

/** One operator account. Session IDs and forwarded host headers are never credentials. */
export function requireOperator(request: Request): NextResponse | null {
  const token = process.env.CLARITY_AUTH_TOKEN ?? "";
  if (token.length < 32) {
    return NextResponse.json({ error: "Configure CLARITY_AUTH_TOKEN with at least 32 random characters." }, { status: 503 });
  }
  const expected = `Basic ${Buffer.from(`clarity:${token}`).toString("base64")}`;
  if (!secretMatches(request.headers.get("authorization") ?? "", expected)) {
    return NextResponse.json({ error: "Authentication required." }, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Clarity", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" ||
        (origin !== null && origin !== (process.env.CLARITY_ORIGIN || "http://localhost:3000"))) {
      return NextResponse.json({ error: "Cross-origin changes are forbidden." }, { status: 403 });
    }
  }
  return null;
}

export function requireWebhook(request: Request): NextResponse | null {
  const secret = process.env.CLARITY_WEBHOOK_SECRET ?? "";
  if (secret.length < 32) return NextResponse.json({ error: "Webhook disabled." }, { status: 503 });
  if (!secretMatches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return null;
}

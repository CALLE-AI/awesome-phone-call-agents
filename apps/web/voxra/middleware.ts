import { NextRequest, NextResponse } from "next/server";

function generateRequestId(): string {
  return crypto.randomUUID();
}

export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? generateRequestId();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);
  const isProd = process.env.NODE_ENV === "production";

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  res.headers.set("x-request-id", requestId);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("cross-origin-opener-policy", "same-origin");
  res.headers.set("cross-origin-resource-policy", "same-site");
  if (isProd) {
    res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }
  res.headers.set(
    "content-security-policy",
    isProd
      ? "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https://seleven-mcp-sg.airudder.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
      : "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: ws:; connect-src 'self' https: ws:; img-src 'self' data: https:; frame-ancestors 'none';"
  );

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

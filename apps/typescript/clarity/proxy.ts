import { NextResponse, type NextRequest } from "next/server";
import { requireOperator, requireWebhook } from "./lib/auth";

export function proxy(request: NextRequest) {
  const denied = request.nextUrl.pathname === "/api/calle/webhook"
    ? requireWebhook(request) : requireOperator(request);
  const response = denied ?? NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

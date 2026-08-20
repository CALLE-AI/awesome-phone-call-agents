import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isAuthRequired(): boolean {
  return Boolean(process.env.OPENINGS_AUTH_TOKEN || process.env.OPENINGS_BASIC_AUTH);
}

function getToken(): string | undefined {
  // OPENINGS_AUTH_TOKEN is the primary shared secret; OPENINGS_BASIC_AUTH="user:pass" also supported
  if (process.env.OPENINGS_AUTH_TOKEN) return process.env.OPENINGS_AUTH_TOKEN;
  const basic = process.env.OPENINGS_BASIC_AUTH;
  if (basic && basic.includes(":")) return basic.split(":").slice(1).join(":");
  return basic;
}

function isValidAuthHeader(value: string | null, token: string): boolean {
  if (!value) return false;
  if (value === `Bearer ${token}`) return true;
  if (value.startsWith("Basic ")) {
    try {
      const decoded = atob(value.slice(6));
      if (decoded === token) return true;
      const colon = decoded.indexOf(":");
      const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;
      if (pass === token) return true;
      // Also accept user:token form
      if (decoded.endsWith(`:${token}`)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function middleware(request: NextRequest) {
  const token = getToken();
  if (!token) return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;

  // Allow Next internals and static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/__nextjs")
  ) {
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  const cookie = request.cookies.get("openings_auth")?.value;

  if (auth && isValidAuthHeader(auth, token)) {
    const res = NextResponse.next();
    // Persist as cookie for subsequent browser navigations
    if (cookie !== token) {
      res.cookies.set("openings_auth", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return res;
  }
  if (cookie === token) return NextResponse.next();

  // Allow setting the cookie via ?token=TOKEN query param (one-time login link)
  const qp = searchParams.get("token");
  if (qp && qp === token) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("token");
    const res = NextResponse.redirect(url);
    res.cookies.set("openings_auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Openings"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

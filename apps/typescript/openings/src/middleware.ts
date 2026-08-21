import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authCookieName,
  authPassword,
  isValidAuthHeader,
  isValidCookieValue,
  readAuthSecret,
} from "./core/auth";

function getSecret() {
  return readAuthSecret({
    OPENINGS_AUTH_TOKEN: process.env.OPENINGS_AUTH_TOKEN,
    OPENINGS_BASIC_AUTH: process.env.OPENINGS_BASIC_AUTH,
  });
}

export function middleware(request: NextRequest) {
  const secret = getSecret();
  if (secret.kind === "none") return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Allow Next internals and static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/__nextjs")
  ) {
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  if (auth && isValidAuthHeader(auth, secret)) {
    const res = NextResponse.next();
    // Persist as cookie for subsequent browser navigations.
    const password = authPassword(secret);
    if (password && request.cookies.get(authCookieName())?.value !== password) {
      res.cookies.set(authCookieName(), password, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return res;
  }

  const cookie = request.cookies.get(authCookieName())?.value;
  if (isValidCookieValue(cookie, secret)) return NextResponse.next();

  // No query-string login: URLs leak into proxy/observability logs and
  // referrers. Browsers get the Basic prompt; API clients use headers.
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Openings"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

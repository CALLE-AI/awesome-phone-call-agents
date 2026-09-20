import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  /* Stripe's webhook. It authenticates by signature, not by a Clerk session,
     so Clerk must not stand in front of it: a POST from Stripe was matching
     no public pattern and being answered 307 to /sign-in, which means the
     handler had never once run. Same shape as the /api/calle/reconcile note
     below - the wrong authority intercepting a request it was never for.

     "/api/webhooks(.*)" was the entry that was meant to cover this. No route
     has ever lived at that path; the real one is under /api/billing. It is
     kept, narrowed to nothing today, only because it costs nothing and a
     future webhook may well land there. */
  "/api/billing/stripe/webhook",
  "/api/webhooks(.*)",
  "/api/uploadthing(.*)",
  "/api/calle/health(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  /* The scheduled sweep is authenticated, just not by Clerk.
   *
   * GET /api/calle/reconcile carries `Authorization: Bearer <CRON_SECRET>`.
   * Clerk reads that header as a session token, fails to parse it as a JWT
   * ("Invalid JWT form", reason=token-invalid, token-carrier=header), treats
   * the caller as signed out, and redirects to /sign-in - so the route never
   * ran. It returned 307 to every external caller, which means the Vercel
   * cron would have hit the same wall had the plan ever let it run.
   *
   * Returning before `auth()` rather than adding the path to isPublicRoute:
   * this is GET only, so the POST variant - the signed-in "check for updates"
   * button - stays behind Clerk. The route still checks the bearer itself and
   * still refuses to run when CRON_SECRET is unset; this only stops Clerk
   * intercepting a request it was never the right authority for. */
  if (req.method === "GET" && req.nextUrl.pathname === "/api/calle/reconcile") {
    return NextResponse.next();
  }

  /* The /dev/* harness is not part of the product.
   *
   * It was reachable in production by anyone signed in - unlisted, which is
   * not the same as closed. It renders replayed calls, component galleries and
   * state harnesses, and none of that should be one guessed URL away from a
   * customer.
   *
   * Closed in production, open in development. ARC_ENABLE_DEV_PAGES=1 reopens
   * it deliberately - the replay call board is worth filming and that is a
   * decision someone should have to make on purpose, not inherit by default.
   * 404 rather than 403: a page that says "forbidden" confirms it exists. */
  if (
    req.nextUrl.pathname.startsWith("/dev") &&
    process.env.VERCEL_ENV === "production" &&
    process.env.ARC_ENABLE_DEV_PAGES !== "1"
  ) {
    return NextResponse.rewrite(new URL("/404", req.url));
  }

  const { userId } = await auth();
  const path = req.nextUrl.pathname;

  // Logged-in user visits / → send to dashboard
  if (userId && path === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Logged-in user visits sign-in or sign-up → send to dashboard
  if (userId && (path.startsWith("/sign-in") || path.startsWith("/sign-up"))) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Not logged in + private route → sign-in
  if (!userId && !isPublicRoute(req)) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

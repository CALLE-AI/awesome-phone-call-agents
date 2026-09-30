import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route prefixes that require a signed-in user. Matched on exact path or `prefix/...`, so
 * `/workflow` and `/workflow/abc` are both covered while a hypothetical `/workflow-docs`
 * is not. Singular and plural forms are both listed for the workflow pages: `/workflow`
 * is the page route, `/workflows` (see TECHNICAL_ARCH.md section 10) is the API
 * namespace, and the guard should hold either way rather than quietly stop matching after
 * a rename. Campaign pages are plural-only (`/campaigns`, `/results`) — there is no
 * singular `/campaign` route.
 *
 * This is a UX guard, not the security boundary — it stops unauthenticated users landing
 * on an empty screen. The real enforcement is RLS in Postgres plus `requireUser()` in
 * lib/supabase/auth.ts, both of which hold even for a request that never passes here.
 */
const PROTECTED_PREFIXES = [
  '/workflow',
  '/workflows',
  '/campaigns',
  '/results',
  '/profile',
  '/api/profile',
  '/api/workflows',
  '/api/campaigns',
  '/api/calls',
] as const;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !user) {
    // Redirecting an API request to an HTML login page hands fetch() a 200 full of markup
    // instead of a status it can branch on, so answer those in kind.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.search = '';
    // So the login form can send the user back where they were actually headed.
    url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // A signed-in user has nothing to do on the auth screens.
  if (user && (pathname === '/auth/login' || pathname === '/auth/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}

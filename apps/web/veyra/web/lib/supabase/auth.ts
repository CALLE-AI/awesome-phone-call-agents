import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { profiles } from '@/lib/db/schema';
import { withRLS } from '@/lib/db/with-rls';
import { createClient } from '@/lib/supabase/server';

/** A user as the UI needs it: identity from auth.users, name from profiles. */
export interface SessionUser {
  id: string;
  email: string | null;
  fullName: string | null;
  companyName: string | null;
  avatarUrl: string | null;
  role: string;
}

/**
 * The signed-in user for server components, or null.
 *
 * Uses `getUser()` rather than `getSession()`: getSession reads the cookie without
 * verifying it, so it can be spoofed. getUser revalidates against the auth server.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // withRLS() impersonates this user for the query, same as any other data read — see
  // lib/db/with-rls.ts. The `where` clause is defense in depth, not the thing doing the
  // scoping: `profiles_select_own` (RLS) would return zero rows here regardless.
  const [profile] = await withRLS(user.id, (tx) =>
    tx
      .select({
        fullName: profiles.fullName,
        companyName: profiles.companyName,
        avatarPath: profiles.avatarPath,
        role: profiles.role,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  );

  return {
    id: user.id,
    email: user.email ?? null,
    // The profile row is created by the on_auth_user_created trigger. Falling back to user
    // metadata covers the instant right after signup if this read races that insert.
    fullName: profile?.fullName ?? (user.user_metadata?.full_name as string) ?? null,
    companyName:
      profile?.companyName ?? (user.user_metadata?.company_name as string) ?? null,
    avatarUrl: profile?.avatarPath ? '/api/profile/image' : null,
    role: profile?.role ?? 'business_user',
  };
}

type RequireUserResult =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: NextResponse };

/**
 * The gate for any API route that reads or writes user-owned data:
 *
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.response;
 *   const { user } = auth;
 *
 * This verifies the session (via Supabase Auth) and nothing else — it does not scope
 * any data query by itself. The returned `supabase` client is PostgREST-backed and
 * user-scoped, but data queries do not go through it any more; pass `user.id` to
 * `withRLS()` from `lib/db/with-rls.ts` instead, which is what actually makes RLS apply
 * to the Drizzle query that follows. Inserts still have to set `userId: user.id`
 * explicitly — the insert policy checks that column, it does not populate it.
 *
 * Never call `getDb()` from `lib/db/client.ts` directly, and never reach for the
 * service-role client, to "make a query work": both bypass RLS entirely, and every
 * route doing that becomes a cross-tenant data leak. The narrow exception is
 * `lib/db/call-lifecycle.ts`: it writes browser-read-only call records for authenticated
 * launches after re-checking campaign ownership, and for secret-authorized CALL-E
 * webhooks that have no user session.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  return { ok: true, supabase, user };
}

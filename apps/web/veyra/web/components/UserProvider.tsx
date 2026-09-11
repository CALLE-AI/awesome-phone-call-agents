'use client';

import { createContext, useContext } from 'react';

import type { SessionUser } from '@/lib/supabase/auth';

/**
 * `undefined` distinguishes "no provider above me" from "provider says nobody is signed
 * in" (`null`), so a component mounted outside the tree fails loudly instead of silently
 * rendering as a logged-out user.
 */
const UserContext = createContext<SessionUser | null | undefined>(undefined);

/**
 * The user is resolved once, server side, in the root layout and handed down as a plain
 * prop — no client-side fetch, no loading flash, nothing to keep in sync. It re-resolves
 * on the `revalidatePath('/', 'layout')` that every auth action fires.
 */
export function UserProvider({
  user,
  children,
}: {
  user: SessionUser | null;
  children: React.ReactNode;
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

/** The signed-in user in a client component, or null when signed out. */
export function useUser(): SessionUser | null {
  const user = useContext(UserContext);

  if (user === undefined) {
    throw new Error('useUser must be used inside <UserProvider> (see app/layout.tsx)');
  }

  return user;
}

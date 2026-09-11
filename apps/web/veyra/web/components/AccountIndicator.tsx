'use client';

import Link from 'next/link';

import { logout } from '@/app/auth/actions';
import { useUser } from '@/components/UserProvider';
import { initialsFor } from '@/lib/initials';

/**
 * The header's account cluster: an initials tile linking to /profile, plus a bare log-out
 * control. Reads the user from context rather than taking props, so any header can drop it
 * in without threading the session through.
 */
export default function AccountIndicator({ active = false }: { active?: boolean }) {
  const user = useUser();

  if (!user) {
    return (
      <Link
        href="/auth/login"
        className="border border-bone/[.22] px-2.5 py-[7px] text-xs font-extrabold tracking-[.02em] text-bone no-underline"
      >
        Log in
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/profile"
        title={user.email ?? undefined}
        className={`inline-flex items-center gap-[9px] border py-[5px] pl-[5px] pr-2.5 no-underline ${
          active ? 'border-flame text-blush' : 'border-bone/[.22] text-bone'
        }`}
      >
        <span
          className="grid size-[26px] place-items-center bg-bone/[.12] bg-cover bg-center text-[11px] font-extrabold"
          style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
        >
          {user.avatarUrl ? null : initialsFor(user.fullName, user.email)}
        </span>
        <span className="max-w-[150px] truncate text-xs font-extrabold tracking-[.02em]">
          {user.fullName ?? user.email}
        </span>
      </Link>

      {/* A plain form, so log out works without client-side JS and the session cookie is
          cleared server side rather than by the browser. */}
      <form action={logout}>
        <button
          type="submit"
          className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[11px] uppercase tracking-[.1em] text-bone/40 hover:text-bone"
        >
          Log out
        </button>
      </form>
    </>
  );
}

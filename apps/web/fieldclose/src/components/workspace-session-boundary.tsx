"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { authClient } from "@/auth-client";
import { BrandMark } from "@/components/brand-mark";

export function WorkspaceSessionBoundary({
  children,
  serverAuthenticated,
}: {
  children: ReactNode;
  serverAuthenticated: boolean;
}) {
  const clientSession = authClient.useSession();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientAuthenticated = Boolean(clientSession.data?.user);
  const authenticated = serverAuthenticated || clientAuthenticated;
  const pending = !serverAuthenticated && clientSession.isPending;
  const query = searchParams.toString();

  useEffect(() => {
    if (pending || authenticated) {
      return;
    }

    const returnTo = `${pathname}${query ? `?${query}` : ""}`;
    router.replace(
      `/?auth=signin&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }, [authenticated, pathname, pending, query, router]);

  if (authenticated) {
    return children;
  }

  return (
    <main className="loading-screen" id="main-content">
      <BrandMark labelled />
      <p>{pending ? "Verifying secure session…" : "Returning to sign in…"}</p>
    </main>
  );
}

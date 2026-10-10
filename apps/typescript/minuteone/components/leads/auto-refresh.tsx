"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls the server component for fresh data — lets a review/dashboard page watch dispatch happen. */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}

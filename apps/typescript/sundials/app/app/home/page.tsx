import { Suspense } from "react";
import { HomeDashboard } from "@/lib/console/HomeDashboard";
import { requireAccount } from "@/lib/console/auth-gate";
import { loadConsole } from "@/lib/console/load";
import { parseRange } from "@/lib/console/format";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const account = await requireAccount();
  const { range } = await searchParams;
  const initial = await loadConsole(parseRange(range), account.id);
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading analytics…</div>}>
      <HomeDashboard initial={initial} />
    </Suspense>
  );
}

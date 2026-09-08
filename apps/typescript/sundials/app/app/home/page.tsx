import { Suspense } from "react";
import { HomeDashboard } from "@/lib/console/HomeDashboard";
import { loadConsole } from "@/lib/console/load";
import { parseRange } from "@/lib/console/format";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const initial = await loadConsole(parseRange(range));
  return (
    <Suspense fallback={<div className="text-[17px] text-[var(--sd-muted)]">Loading analytics…</div>}>
      <HomeDashboard initial={initial} />
    </Suspense>
  );
}

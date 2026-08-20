import { notFound } from "next/navigation";
import { createApp } from "@/app/app";
import { requireAuth } from "@/app/auth";
import { getConfig } from "@/app/config";
import { maskE164 } from "@/core/frame";
import { WatchClient } from "@/components/watch-client";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  const watch = app.getWatch(id);
  if (!watch) notFound();

  const runState = app.getWatchRunState(id);
  const results = app.getLatestResults(id);

  // Mask full numbers before passing to the client bundle (defense in depth:
  // UI also masks, but the RSC payload should not contain full numbers).
  const maskedWatch = {
    ...watch,
    candidates: watch.candidates.map((c) => ({
      ...c,
      phoneE164: maskE164(c.phoneE164),
      phoneDisplay: maskE164(c.phoneE164),
    })),
  };

  return <WatchClient watch={maskedWatch} runCount={runState.runCount} results={results} />;
}

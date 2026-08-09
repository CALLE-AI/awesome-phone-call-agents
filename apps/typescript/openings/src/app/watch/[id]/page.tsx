import { notFound } from "next/navigation";
import { createApp } from "@/app/app";
import { getConfig } from "@/app/config";
import { WatchClient } from "@/components/watch-client";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  const watch = app.getWatch(id);
  if (!watch) notFound();

  const runState = app.getWatchRunState(id);
  const results = app.getLatestResults(id);

  return <WatchClient watch={watch} runCount={runState.runCount} results={results} />;
}

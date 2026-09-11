import { notFound } from "next/navigation";

import ShellHarness from "../../shell/ShellHarness";
import CalleStates from "./CalleStates";

const STATES = ["idle", "dialing", "queued", "inprogress", "done", "simulated", "failed", "batch"] as const;

/* Every LiveCallCard state on one page. The card owns its own phase, so the
   harness drives it through a thin client wrapper rather than by faking props. */
export default async function DevCallePage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  if (!STATES.includes(state as (typeof STATES)[number])) notFound();
  return (
    <ShellHarness>
      <CalleStates state={state as (typeof STATES)[number]} />
    </ShellHarness>
  );
}

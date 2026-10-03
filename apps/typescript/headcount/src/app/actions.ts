"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCoverageSnapshot } from "@/lib/queries";
import { advanceInProgress, cancelInProgress, getKilled, runNextWave, setKilled } from "@/lib/wave-runner";

export async function toggleKill() {
  const next = !getKilled();
  setKilled(next);
  if (next) cancelInProgress();
  revalidatePath("/", "layout");
}

export async function confirmWave(eventId: string) {
  const result = runNextWave(eventId);
  if (!result.ok) {
    revalidatePath(`/events/${eventId}/waves/new`);
    return;
  }
  revalidatePath("/", "layout");
  redirect(`/events/${eventId}`);
}

export async function pollCoverage(eventId: string) {
  advanceInProgress(eventId);
  return getCoverageSnapshot(eventId);
}
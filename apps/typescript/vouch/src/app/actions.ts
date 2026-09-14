"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getConsent, getKilled, getVouchSnapshot, setKilled } from "@/lib/queries";
import { advanceInProgress, cancelInProgress, confirmDial } from "@/lib/runner";

export async function toggleKill() {
  const next = !getKilled();
  setKilled(next);
  if (next) cancelInProgress();
  revalidatePath("/", "layout");
}

export async function confirmVouchDial(consentId: string) {
  const consent = getConsent(consentId);
  if (!consent) {
    revalidatePath(`/consents/${consentId}`);
    return;
  }
  const result = confirmDial(consent);
  if (!result.ok) {
    revalidatePath(`/consents/${consentId}`);
    return;
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function pollBoard() {
  advanceInProgress();
  return getVouchSnapshot();
}
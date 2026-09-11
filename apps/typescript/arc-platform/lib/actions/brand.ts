"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { isAllowedLogoUrl } from "@/lib/logo-url";

/**
 * Rename the caller's brand.
 *
 * getOrCreateBrand seeds the name from the Clerk profile, which means a new
 * account starts with a person's name where a company's belongs - it shows in
 * the dashboard greeting and the breadcrumb. This makes it editable.
 */
export async function updateBrandName(
  name: string
): Promise<{ success: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "Not authenticated" };

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { success: false, error: "Brand name must be at least 2 characters" };
  }

  try {
    const brand = await getOrCreateBrand(userId);
    /* Saving the name is what "confirmed" means - see lib/brand.ts. Set here
       too, not only at /welcome, so someone who reaches Settings first is not
       sent back to a screen asking for something they have just supplied. */
    await db.brand.update({
      where: { id: brand.id },
      data: { name: trimmed, onboardingDone: true },
    });
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    console.error("[updateBrandName]", err);
    return { success: false, error: "Couldn't save that. Try again." };
  }
}

/**
 * Store the brand's logo, or clear it.
 *
 * No code in the app writes logoUrl. One brand on the live database has one
 * anyway, set outside the app, so the column is not unused - just unreachable
 * from the product. Every other brand falls back to initials of the brand
 * name, which while that name was guessed from a Clerk profile meant initials
 * of the wrong thing entirely.
 *
 * NOTE: nothing calls this yet. UPLOADTHING_TOKEN is set in no environment, so
 * an upload button wired to logoUploader would fail on click, and shipping a
 * control that cannot work is the thing this codebase keeps removing. The
 * action is here, validated, for when the token is.
 *
 * The URL comes from uploadthing's logoUploader, which already existed and had
 * no caller. Only uploadthing's own host is accepted: this is a URL arriving
 * from a client, and it is rendered in an <img> on every page of the app.
 */
export async function updateBrandLogo(
  logoUrl: string | null
): Promise<{ success: boolean; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "Not authenticated" };

  if (logoUrl !== null && !isAllowedLogoUrl(logoUrl)) {
    return { success: false, error: "Upload the image rather than pasting a link." };
  }

  try {
    const brand = await getOrCreateBrand(userId);
    await db.brand.update({ where: { id: brand.id }, data: { logoUrl } });
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    console.error("[updateBrandLogo]", err);
    return { success: false, error: "Couldn't save that. Try again." };
  }
}

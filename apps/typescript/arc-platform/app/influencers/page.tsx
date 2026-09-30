import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import AppShell from "@/components/app-shell/AppShell";
import { getOrCreateBrand } from "@/lib/brand";
import { db } from "@/lib/db";
import { getCreator, type Creator } from "./_data";
import InfluencerMarket, { type DirectoryCreator } from "./_components/InfluencerMarket";

/**
 * The directory lists the CATALOGUE, not the eight creators we wrote up.
 *
 * Same fix as /radio, and for the same reason: plan generation reads the
 * Contact table, so a plan could recommend a creator this page said did not
 * exist - and the page said "8" while the table held 32. `_data.ts` supplies
 * the rich card for the eight it describes; the rest get the short one, with
 * what is missing named rather than filled in.
 */
/* Reads the Contact table, so it cannot be prerendered - the build has no
   database connection during export. */
export const dynamic = "force-dynamic";

export default async function InfluencersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const brand = await getOrCreateBrand(userId);

  const campaigns = await db.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const contacts = await db.contact.findMany({
    where: { type: "CREATOR" },
    orderBy: [{ name: "asc" }],
    select: {
      externalId: true, name: true, handle: true, channel: true, city: true,
      category: true, audience: true, audienceBasis: true, rateEstimatePkr: true,
      phone: true, profile: true,
    },
  });

  const items: DirectoryCreator[] = contacts.map((c) => ({
    externalId: c.externalId,
    name: c.name,
    handle: (c.handle ?? c.externalId).replace(/^@/, ""),
    channel: c.channel,
    city: c.city,
    category: c.category,
    audience: c.audience,
    audienceBasis: c.audienceBasis,
    rateEstimatePkr: c.rateEstimatePkr,
    hasPhone: Boolean(c.phone),
    /* Keyed by username in _data.ts, which is the same string as the
       catalogue's externalId for the eight that overlap. */
    /* Hand-researched first, then the generated write-up in the profile
       column - the same Creator shape, through the same card. */
    detail:
      getCreator((c.handle ?? c.externalId).replace(/^@/, "")) ??
      ((c.profile as Creator | null) ?? null),
  }));

  return (
    <AppShell>
      <InfluencerMarket items={items} campaigns={campaigns} />
    </AppShell>
  );
}

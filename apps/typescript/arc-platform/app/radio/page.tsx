import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import AppShell from "@/components/app-shell/AppShell";
import { getOrCreateBrand } from "@/lib/brand";
import { db } from "@/lib/db";
import { getStation, type Station } from "./_data";
import StationDirectory, { type DirectoryStation } from "./_components/StationDirectory";

/**
 * The directory lists the CATALOGUE, not the eight stations we wrote up.
 *
 * Plan generation reads the Contact table, so a Multan brief can return Multan
 * stations - while this page still said "8 of 8" and did not contain them.
 * Both now come from the same place. `_data.ts` supplies the rich card for the
 * eight it describes; the rest get the short one.
 */
/* Reads the Contact table, so it cannot be prerendered - the build has no
   database connection during export. */
export const dynamic = "force-dynamic";

export default async function RadioPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const brand = await getOrCreateBrand(userId);

  /* The brand's own campaigns. The picker used to list two string literals
     that belonged to nobody. */
  const campaigns = await db.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const contacts = await db.contact.findMany({
    where: { type: "STATION" },
    orderBy: [{ name: "asc" }, { city: "asc" }],
    select: {
      externalId: true, name: true, formerName: true, city: true, frequency: true,
      category: true, owner: true, audience: true, audienceBasis: true,
      rateEstimatePkr: true, phone: true, profile: true,
      rateProvenance: true, audienceProvenance: true, sourceNote: true,
    },
  });

  const items: DirectoryStation[] = contacts.map((c) => ({
    externalId: c.externalId,
    name: c.name,
    formerName: c.formerName,
    city: c.city,
    frequency: c.frequency,
    category: c.category,
    owner: c.owner,
    audience: c.audience,
    audienceBasis: c.audienceBasis,
    rateEstimatePkr: c.rateEstimatePkr,
    rateProvenance: c.rateProvenance,
    audienceProvenance: c.audienceProvenance,
    sourceNote: c.sourceNote,
    hasPhone: Boolean(c.phone),
    /* The hand-researched write-up wins; otherwise the generated one in the
       profile column, which is the same Station shape and renders through the
       same card. */
    detail: getStation(c.externalId) ?? ((c.profile as Station | null) ?? null),
  }));

  return (
    <AppShell>
      <StationDirectory items={items} campaigns={campaigns} />
    </AppShell>
  );
}

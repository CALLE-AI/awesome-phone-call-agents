import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import AppShell from "@/components/app-shell/AppShell";
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { getCreator, type Creator } from "../_data";
import CreatorProfile from "./_components/CreatorProfile";
import ContactProfile from "@/app/_components/ContactProfile";

export default async function CreatorPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const brand = await getOrCreateBrand(userId);

  /* The booking form used to offer two hardcoded campaign names. A brand's
     campaigns are in the database, so it now offers the real ones. */
  const campaigns = await db.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  /* Same shape as the station page: hand-researched write-up first, then the
     generated one in the profile column, and the short page only for a row
     that has neither. */
  const contact = await db.contact.findFirst({
    where: { OR: [{ externalId: username }, { handle: `@${username}` }] },
    select: {
      externalId: true, name: true, type: true, channel: true, city: true,
      frequency: true, owner: true, handle: true, category: true,
      audience: true, audienceBasis: true, rateEstimatePkr: true, phone: true,
      profile: true,
    },
  });

  const creator = getCreator(username) ?? ((contact?.profile as Creator | null) ?? null);

  if (!creator) {
    if (!contact) notFound();
    return (
      <AppShell crumb={contact.name}>
        <ContactProfile contact={contact} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={creator.displayName}>
      <CreatorProfile creator={creator} campaigns={campaigns} />
    </AppShell>
  );
}

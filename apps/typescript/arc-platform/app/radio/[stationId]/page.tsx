import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import AppShell from "@/components/app-shell/AppShell";
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { getStation, type Station } from "../_data";
import StationProfile from "./_components/StationProfile";
import ContactProfile from "@/app/_components/ContactProfile";

export default async function StationPage({ params }: { params: Promise<{ stationId: string }> }) {
  const { stationId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const brand = await getOrCreateBrand(userId);

  /* The booking form offered two hardcoded campaign names. A brand's
     campaigns are in the database, so it offers the real ones. */
  const campaigns = await db.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  /* _data.ts describes eight stations by hand; the rest carry a generated
     write-up in the Contact table's profile column, in the same Station shape.
     Either way the full page renders. ContactProfile remains the fallback for
     a contact that somehow has neither - a row seeded after the last run of
     scripts/seed-profiles.ts - because a plan can recommend any of them and a
     recommended line must never lead to a 404. */
  const contact = await db.contact.findUnique({
    where: { externalId: stationId },
    select: {
      externalId: true, name: true, type: true, channel: true, city: true,
      frequency: true, owner: true, handle: true, category: true,
      audience: true, audienceBasis: true, rateEstimatePkr: true, phone: true,
      profile: true,
    },
  });

  const station = getStation(stationId) ?? ((contact?.profile as Station | null) ?? null);

  if (!station) {
    if (!contact) notFound();
    return (
      <AppShell crumb={contact.name}>
        <ContactProfile contact={contact} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={station.name}>
      <StationProfile station={station} campaigns={campaigns} />
    </AppShell>
  );
}

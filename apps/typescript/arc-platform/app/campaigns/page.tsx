import { auth } from "@clerk/nextjs/server";
import AppShell from "@/components/app-shell/AppShell";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import CampaignList from "./_components/CampaignList";
import { stationSegments } from "@/app/dashboard/_components/emptyStateData";

export default async function CampaignsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);
  /* Item statuses and the flight come with the row so the badge can be
     derived rather than trusted - see lib/campaign-status.ts. */
  const campaigns = await db.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { status: true } } },
  });

  return (
    <AppShell>
      {/* Breadcrumb lives in the shell header - this page owns its title only. */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 font-display text-h1 text-text">
          All Campaigns
          <Badge variant="outline">{campaigns.length}</Badge>
        </h1>
      </header>

      <CampaignList campaigns={campaigns} segments={stationSegments()} />
    </AppShell>
  );
}

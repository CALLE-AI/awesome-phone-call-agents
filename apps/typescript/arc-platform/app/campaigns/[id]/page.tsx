import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";

import AppShell from "@/components/app-shell/AppShell";
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import CampaignDetail from "./_components/CampaignDetail";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);

  /* The plan is now part of the campaign, so it loads with it. Campaigns
     created before the migration simply have no items or scripts, and the
     page says so rather than inventing any. */
  const campaign = await db.campaign.findFirst({
    where: { id, brandId: brand.id },
    include: {
      items: {
        orderBy: [{ kind: "asc" }, { estCostPkr: "desc" }],
        /* The confirming call comes with the line so the page can say whether
           a confirmed rate was heard on a real call or generated in demo
           mode. Without this a simulated rate renders identically to a real
           one, which is the one thing section 9 does not allow. */
        include: {
          calls: {
            select: {
              mock: true, outcome: true,
              /* What the call itself said about how it went. Without these the
                 plan table shows a confirmed rate with no way to tell whether
                 anyone confirmed it. */
              rateConfirmed: true, confidenceLabel: true, evidence: true,
              /* The id the plan's "heard here" link points at. */
              calleCallId: true, transcript: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      scripts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!campaign) notFound();

  /* The name reaches the breadcrumb through the shell rather than through a
     second header of this page's own. */
  return (
    <AppShell crumb={campaign.name}>
      <CampaignDetail campaign={campaign} brandName={brand.name} />
    </AppShell>
  );
}

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getOrCreateBrand } from "@/lib/brand";
import { getBrandAnalytics } from "@/lib/analytics";
import { db } from "@/lib/db";
import AnalyticsDashboard from "./_components/AnalyticsDashboard";
import AnalyticsEmpty from "./_components/AnalyticsEmpty";
import AnalyticsNoPlanData from "./_components/AnalyticsNoPlanData";

/**
 * Three states, because there are three genuinely different situations.
 *
 *   no campaigns          - an invitation
 *   campaigns, no plan    - what most brands see: every campaign predates the
 *                           wizard storing a plan, so there is nothing to
 *                           report on and the page says so
 *   plan data             - real figures, read from the database
 *
 * Nothing on the third state is illustrative, so nothing on it is marked. The
 * blocks that used to be marked - the reach chart, time slots, and the whole
 * attribution section - are gone rather than pilled: see section 9.
 */
export default async function AnalyticsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const brand = await getOrCreateBrand(userId);
  const stats = await getBrandAnalytics(brand.id);

  if (stats.totalCampaigns === 0) return <AnalyticsEmpty />;
  if (!stats.hasPlanData) return <AnalyticsNoPlanData campaignCount={stats.totalCampaigns} />;

  const campaigns = await db.campaign.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, status: true, currency: true,
      budgetTotal: true, estTotalReach: true, flightStart: true, flightEnd: true,
      items: {
        select: {
          id: true, name: true, kind: true, city: true, channel: true,
          spots: true, bookedTotalPkr: true, bookedAt: true, status: true,
        },
      },
    },
  });

  return <AnalyticsDashboard stats={stats} campaigns={campaigns} />;
}

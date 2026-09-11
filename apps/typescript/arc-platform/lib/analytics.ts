import { db } from "@/lib/db";

/**
 * The brand's real reporting figures.
 *
 * One query, used by both the analytics page and the dashboard's committed
 * card, so the two cannot disagree about the same number.
 *
 * Everything here is read from the database. Nothing is estimated, inferred or
 * defaulted: a brand with no plan data gets zeros and `hasPlanData: false`, and
 * the caller says so rather than rendering a page of zeros.
 *
 * On the word "committed": this is the sum of what was BOOKED, not what was
 * spent. No payment is tied to a campaign anywhere in the app, so calling it
 * spend would be a category error - see BRANDING.md section 9.
 */
export interface BrandAnalytics {
  activeCampaigns: number;
  totalCampaigns: number;
  /** Sum of bookedTotalPkr across every line of every campaign. */
  committedPkr: number;
  /** Sum of the budgets approved at launch. */
  budgetPkr: number;
  /** Sum of estTotalReach - the plan's estimate, never a measurement. */
  plannedReach: number;
  bookedLines: number;
  totalLines: number;
  currency: string;
  /** False when no campaign carries a plan: every campaign predates the
   *  wizard storing one, so there is nothing to report on yet. */
  hasPlanData: boolean;
}

export async function getBrandAnalytics(brandId: string): Promise<BrandAnalytics> {
  const [campaigns, items] = await Promise.all([
    db.campaign.findMany({
      where: { brandId },
      select: { status: true, budgetTotal: true, estTotalReach: true, currency: true },
    }),
    db.mediaPlanItem.findMany({
      where: { campaign: { brandId } },
      select: { bookedTotalPkr: true, bookedAt: true },
    }),
  ]);

  const committedPkr = items.reduce((s, i) => s + (i.bookedTotalPkr ?? 0), 0);
  const budgetPkr = campaigns.reduce((s, c) => s + (c.budgetTotal ?? 0), 0);
  const plannedReach = campaigns.reduce((s, c) => s + (c.estTotalReach ?? 0), 0);

  return {
    activeCampaigns: campaigns.filter(c => c.status === "ACTIVE").length,
    totalCampaigns: campaigns.length,
    committedPkr,
    budgetPkr,
    plannedReach,
    bookedLines: items.filter(i => i.bookedAt).length,
    totalLines: items.length,
    currency: campaigns.find(c => c.currency)?.currency ?? "PKR",
    hasPlanData: items.length > 0 || budgetPkr > 0 || plannedReach > 0,
  };
}

import { notFound } from "next/navigation";

import ShellHarness from "../../shell/ShellHarness";
import AnalyticsDashboard from "@/app/analytics/_components/AnalyticsDashboard";
import AnalyticsEmpty from "@/app/analytics/_components/AnalyticsEmpty";
import AnalyticsNoPlanData from "@/app/analytics/_components/AnalyticsNoPlanData";
import type { BrandAnalytics } from "@/lib/analytics";

/* All three states of /analytics. The "real" fixture mirrors the only brand in
   the database that actually has plan data, so what is reviewed is the shape a
   real account produces rather than a flattering invention. */
const STATS: BrandAnalytics = {
  activeCampaigns: 2,
  totalCampaigns: 2,
  committedPkr: 22000,
  budgetPkr: 999952,
  plannedReach: 520000,
  bookedLines: 1,
  totalLines: 2,
  currency: "PKR",
  hasPlanData: true,
};

const CAMPAIGNS = [
  {
    id: "c1", name: "First Campaign for meezan", status: "ACTIVE", currency: "PKR",
    budgetTotal: 999952, estTotalReach: 520000,
    flightStart: new Date(Date.UTC(2026, 8, 1)), flightEnd: new Date(Date.UTC(2026, 8, 30)),
    items: [
      { id: "i1", name: "Mast FM 103", kind: "STATION" as const, city: "Lahore", channel: "radio",
        spots: 2, bookedTotalPkr: 22000, bookedAt: new Date(Date.UTC(2026, 7, 27)), status: "BOOKED" },
      { id: "i2", name: "Sana Malik", kind: "CREATOR" as const, city: "Karachi", channel: "instagram",
        spots: null, bookedTotalPkr: null, bookedAt: null, status: "SELECTED" },
    ],
  },
  {
    id: "c2", name: "New Pro", status: "ACTIVE", currency: "PKR",
    budgetTotal: null, estTotalReach: null, flightStart: null, flightEnd: null, items: [],
  },
];

export default async function DevAnalyticsPage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  if (!["empty", "noplan", "real"].includes(state)) notFound();
  return (
    <ShellHarness>
      {state === "empty" ? (
        <AnalyticsEmpty />
      ) : state === "noplan" ? (
        <AnalyticsNoPlanData campaignCount={6} />
      ) : (
        <AnalyticsDashboard stats={STATS} campaigns={CAMPAIGNS} />
      )}
    </ShellHarness>
  );
}

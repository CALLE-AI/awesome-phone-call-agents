import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { getBrandAnalytics } from "@/lib/analytics";
import DashboardHome from "./_components/DashboardHome";
import EmptyState from "./_components/EmptyState";
import { stationSegments, sampleCallMoment } from "./_components/emptyStateData";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const base = await getOrCreateBrand(userId);
  const brand = await db.brand.findUniqueOrThrow({
    where: { id: base.id },
    /* Item statuses come along so the dashboard can derive what each campaign
       is actually doing rather than trusting a write-once column. */
    include: {
      campaigns: {
        orderBy: { createdAt: "desc" },
        include: { items: { select: { status: true } } },
      },
    },
  });
  const firstName = brand.name.split(" ")[0];

  if (brand.campaigns.length === 0) {
    return (
      <EmptyState
        firstName={firstName}
        segments={stationSegments()}
        callMoment={sampleCallMoment()}
      />
    );
  }

  /* Same query the analytics page uses, so the committed figure cannot
     disagree between the two pages. */
  const stats = await getBrandAnalytics(brand.id);

  /* Real events, in place of the invented feed that used to sit here -
     "Payment confirmed — PKR 80,000", "Campaign 'Khaadi Summer' created",
     none of which had happened. Calls are the only thing this product does
     that generates a timeline, so calls are the timeline. */
  const recentCalls = await db.call.findMany({
    where: { brandId: brand.id, mock: false },
    orderBy: { createdAt: "desc" },
    /* Enough to group repeated failures meaningfully. Four attempts at one
       station are one problem, not four events - see the feed. */
    take: 24,
    select: {
      calleCallId: true, targetName: true, outcome: true, status: true,
      pricePkr: true, rateConfirmed: true, createdAt: true, done: true,
    },
  });

  /* Reach, added up from the plan rather than asserted. The card used to read
     a flat "4.2M ... across 2 stations + 4 influencers" for every brand. */
  const planned = await db.mediaPlanItem.aggregate({
    where: { campaign: { brandId: brand.id } },
    _sum: { estReach: true },
    _count: true,
  });
  /* Replaces an invented "Avg engagement rate 6.8%, +0.4% vs last month,
     industry avg 3.1%" - three numbers, no source, on the first screen. Arc
     does not measure engagement. It does measure this. */
  const callsPlaced = await db.call.count({ where: { brandId: brand.id, mock: false } });
  const ratesConfirmed = await db.call.count({
    where: { brandId: brand.id, mock: false, rateConfirmed: true },
  });

  /* What a buyer should do next, from real state. Lines that have been
     planned but never priced by a call are the whole job of this product. */
  const openLines = await db.mediaPlanItem.findMany({
    where: { campaign: { brandId: brand.id }, confirmedRatePkr: null },
    select: { id: true, name: true, externalId: true, campaignId: true, kind: true },
    take: 10,
  });
  const unreachable = await db.contact.findMany({
    where: { phone: null, externalId: { in: openLines.map((l) => l.externalId) } },
    select: { externalId: true },
  });

  const lineCounts = await db.mediaPlanItem.groupBy({
    by: ["kind"],
    where: { campaign: { brandId: brand.id } },
    _count: true,
  });

  return (
    <DashboardHome
      brand={brand}
      firstName={firstName}
      campaigns={brand.campaigns}
      stats={stats}
      recentCalls={recentCalls.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      }))}
      calls={{ placed: callsPlaced, confirmed: ratesConfirmed }}
      todo={{
        openLines: openLines.map((l) => ({
          ...l,
          callable: !unreachable.some((u) => u.externalId === l.externalId),
        })),
      }}
      reach={{
        total: planned._sum.estReach ?? 0,
        stations: lineCounts.find((l) => l.kind === "STATION")?._count ?? 0,
        creators: lineCounts.find((l) => l.kind === "CREATOR")?._count ?? 0,
      }}
    />
  );
}

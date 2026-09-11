import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";

/**
 * Book one line of a campaign's media plan.
 *
 * Before this route, both booking forms ran a 1.5s setTimeout and then claimed
 * the spots were reserved. Nothing was written: a refresh and the booking had
 * never happened. This is the write that makes that claim true.
 *
 * It records terms, not estimates. `bookedTotalPkr` is computed here from the
 * rates the caller sends per line rather than copied from `estCostPkr` or
 * `confirmedRatePkr`, because what a brand commits to is its own fact - it may
 * differ from both the wizard's guess and the rate a call quoted.
 *
 * A booking must belong to a campaign. MediaPlanItem.campaignId is not
 * nullable and there is nowhere honest to file a booking that belongs to no
 * campaign, so the station and creator forms require one.
 */

interface Body {
  campaignId?: string;
  /** Catalogue id from app/radio/_data.ts or app/influencers/_data.ts. */
  externalId?: string;
  kind?: "STATION" | "CREATOR";
  name?: string;
  channel?: string | null;
  city?: string | null;
  /** ISO dates the brand picked. */
  dates?: string[];
  /** Slot labels for radio; empty for creators. */
  slots?: string[];
  /** Rate per spot / per post, as shown in the form. */
  ratePkr?: number;
  /** Spots = dates x slots for radio, or 1 for a creator package. */
  spots?: number;
}

function int(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const brand = await getOrCreateBrand(userId);
  const body = (await req.json()) as Body;

  if (!body.campaignId) {
    return NextResponse.json(
      { error: "Select a campaign before booking. A booking has to belong to one." },
      { status: 400 }
    );
  }
  if (!body.name || (body.kind !== "STATION" && body.kind !== "CREATOR")) {
    return NextResponse.json({ error: "Missing booking target." }, { status: 400 });
  }

  // Scoped to the caller's brand: a campaign id from elsewhere is a 404.
  const campaign = await db.campaign.findFirst({
    where: { id: body.campaignId, brandId: brand.id },
    select: { id: true, currency: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const dates = (body.dates ?? []).map(d => new Date(d)).filter(d => !Number.isNaN(d.getTime()));
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const rate = int(body.ratePkr);
  const spots = int(body.spots) ?? Math.max(1, dates.length * Math.max(slots.length, 1));
  const total = rate != null ? rate * spots : null;

  /* The line may already exist - the wizard puts every selected station and
     creator on the plan at launch, and booking one of those should complete
     that row rather than create a second one for the same target. */
  const existing = await db.mediaPlanItem.findFirst({
    where: {
      campaignId: campaign.id,
      kind: body.kind,
      ...(body.externalId ? { externalId: body.externalId } : { name: body.name }),
    },
  });

  const terms = {
    spots,
    bookedDates: dates,
    bookedSlots: slots,
    bookedTotalPkr: total,
    bookedAt: new Date(),
    status: "BOOKED" as const,
  };

  const item = existing
    ? await db.mediaPlanItem.update({ where: { id: existing.id }, data: terms })
    : await db.mediaPlanItem.create({
        data: {
          campaignId: campaign.id,
          kind: body.kind,
          externalId: body.externalId ?? "",
          name: body.name,
          channel: body.channel ?? null,
          city: body.city ?? null,
          recommendedSlots: [],
          ...terms,
        },
      });

  return NextResponse.json({
    id: item.id,
    name: item.name,
    spots: item.spots,
    bookedTotalPkr: item.bookedTotalPkr,
    currency: campaign.currency ?? "PKR",
    dates: item.bookedDates.map(d => d.toISOString()),
    addedToPlan: !existing,
  });
}

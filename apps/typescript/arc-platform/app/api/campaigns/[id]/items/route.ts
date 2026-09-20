import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";

/**
 * Add one station or creator to a campaign's plan, from the directory.
 *
 * The directories had an "Add to campaign" control that listed two campaigns
 * that do not exist - "Herbion Shampoo - Q1 2025" and "Shan Masalas - Ramadan"
 * were string literals in the JSX - and selecting one did nothing but toggle a
 * badge. This is the write that makes the control mean something.
 *
 * The line lands as SELECTED, not BOOKED. Adding a station to a plan is not
 * committing to spend money with it; booking is a separate act with its own
 * route and its own terms.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: campaignId } = await params;
  const brand = await getOrCreateBrand(userId);

  /* Scoped to the brand, not just to the id: a campaign id is guessable and
     nobody should be able to write a line into someone else's plan. */
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, brandId: brand.id },
    select: { id: true, name: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const body = (await req.json()) as {
    externalId?: string;
    kind?: "STATION" | "CREATOR";
  };
  if (!body.externalId || (body.kind !== "STATION" && body.kind !== "CREATOR")) {
    return NextResponse.json({ error: "externalId and kind are required." }, { status: 400 });
  }

  /* Facts come from the Contact table, never from the client. A page that can
     name its own city and rate can put anything into a plan. */
  const contact = await db.contact.findUnique({
    where: { externalId: body.externalId },
    select: {
      externalId: true, name: true, type: true, channel: true, city: true,
      audience: true, rateEstimatePkr: true,
    },
  });
  if (!contact || contact.type !== body.kind) {
    return NextResponse.json({ error: "That contact is not in the catalogue." }, { status: 404 });
  }

  const existing = await db.mediaPlanItem.findFirst({
    where: { campaignId: campaign.id, externalId: contact.externalId },
    select: { id: true },
  });
  if (existing) {
    /* Not an error. Adding a line twice is a person clicking twice, and the
       honest answer is that it is already there. */
    return NextResponse.json({
      ok: true, alreadyPresent: true, campaignName: campaign.name, itemId: existing.id,
    });
  }

  const item = await db.mediaPlanItem.create({
    data: {
      campaignId: campaign.id,
      kind: contact.type,
      externalId: contact.externalId,
      name: contact.name,
      channel: contact.channel,
      city: contact.city,
      /* The catalogue's estimate, marked as an estimate. confirmedRatePkr stays
         null until a call confirms a rate - see applyResultToItem. */
      estCostPkr: contact.rateEstimatePkr,
      estReach: contact.audience,
      rationale: "Added from the directory",
      status: "SELECTED",
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, campaignName: campaign.name, itemId: item.id });
}

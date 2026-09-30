import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getOrCreateBrand } from "@/lib/brand";
import { toUTCDate } from "@/lib/flight";
import { linkCallsToItems } from "@/lib/calls";

/**
 * Create a campaign, and persist the media plan the brand just approved.
 *
 * This route used to accept `{ name, status }` and nothing else, so everything
 * StepReview computed - selected scripts, stations and creators, per-item cost
 * and reach, the three cost lines and the totals - was discarded the moment
 * the campaign existed. That is why /campaigns/<id> could only ever show three
 * facts. The plan now lands in MediaPlanItem, CampaignScript and the Campaign
 * aggregate columns.
 *
 * The plan is optional: a body carrying only `{ name, status }` still works
 * and simply creates a campaign with no items, which is what every one of the
 * eighteen pre-migration campaigns looks like.
 */

type ItemKind = "STATION" | "CREATOR";

interface IncomingItem {
  kind: ItemKind;
  externalId: string;
  name: string;
  channel?: string | null;
  city?: string | null;
  estCostPkr?: number | null;
  estReach?: number | null;
  matchScore?: number | null;
  rationale?: string | null;
  recommendedSlots?: string[];
}

interface IncomingScript {
  externalId?: string | null;
  language: string;
  durationSec: number;
  title: string;
  hook: string;
  body: string;
  callToAction: string;
  voiceDirection?: string | null;
  bestTimeSlots?: string[];
  targetSegment?: string | null;
}

/** Money and reach are stored as whole units; anything unusable becomes null
 *  rather than 0, so "not known" never renders as a real zero. */
function int(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

function float(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A flight date is a calendar date. UTC midnight, so it survives a server in
 *  one timezone rendering for a user in another. A bad or missing value is
 *  null, never today. */
function date(v: unknown): Date | null {
  return typeof v === "string" ? toUTCDate(v) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Was a 404 "No brand found" - the failure that broke Launch.
  const brand = await getOrCreateBrand(userId);

  const body = await req.json();
  const { name, status } = body as { name?: string; status?: string };

  const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];
  const scripts: IncomingScript[] = Array.isArray(body.scripts) ? body.scripts : [];

  const campaign = await db.$transaction(async tx => {
    const created = await tx.campaign.create({
      data: {
        brandId: brand.id,
        name: name || "Untitled Campaign",
        status: status || "DRAFT",

        budgetTotal: int(body.budgetTotal),
        currency: str(body.currency) ?? "PKR",
        durationDays: int(body.durationDays),
        /* The brief captures a start date now; the end is derived from it and
           the duration. Both stay null for a payload that omits them, which is
           every campaign launched before the field existed. */
        flightStart: date(body.flightStart),
        flightEnd: date(body.flightEnd),

        estStationCost: int(body.estStationCost),
        estInfluencerCost: int(body.estInfluencerCost),
        estPlatformFee: int(body.estPlatformFee),
        estTotalCost: int(body.estTotalCost),
        estTotalReach: int(body.estTotalReach),

        brief: body.brief ?? undefined,
      },
    });

    if (items.length > 0) {
      await tx.mediaPlanItem.createMany({
        data: items
          .filter(i => i && (i.kind === "STATION" || i.kind === "CREATOR") && i.name)
          .map(i => ({
            campaignId: created.id,
            kind: i.kind,
            externalId: String(i.externalId ?? ""),
            name: i.name,
            channel: str(i.channel),
            city: str(i.city),
            estCostPkr: int(i.estCostPkr),
            estReach: int(i.estReach),
            matchScore: float(i.matchScore),
            rationale: str(i.rationale),
            recommendedSlots: Array.isArray(i.recommendedSlots) ? i.recommendedSlots : [],
          })),
      });
    }

    if (scripts.length > 0) {
      await tx.campaignScript.createMany({
        data: scripts
          .filter(s => s && s.title)
          .map(s => ({
            campaignId: created.id,
            externalId: str(s.externalId),
            language: s.language ?? "urdu",
            durationSec: int(s.durationSec) ?? 30,
            title: s.title,
            hook: s.hook ?? "",
            body: s.body ?? "",
            callToAction: s.callToAction ?? "",
            voiceDirection: str(s.voiceDirection),
            bestTimeSlots: Array.isArray(s.bestTimeSlots) ? s.bestTimeSlots : [],
            targetSegment: str(s.targetSegment),
          })),
      });
    }

    /* Calls are placed on the review step, before this campaign existed, so
       they were written with no campaign or item. Now that the plan has rows,
       each line picks up the call that was made for it. */
    if (items.length > 0) {
      await linkCallsToItems(tx, brand.id, created.id);
    }

    return created;
  }, { timeout: 20000, maxWait: 10000 });

  return NextResponse.json({ id: campaign.id, name: campaign.name });
}

import { Fragment } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Wallet, Mic, Radio, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TunerStrip, type TunerSegment, type TunerTone } from "@/components/ui/tuner-strip";
import { formatFlightDate } from "@/lib/flight";
import { MediaPlanTable } from "./PlanCalling";
import { advertiserName } from "@/lib/advertiser";
import { deriveCampaignStatus } from "@/lib/campaign-status";

/** Status tone as a token NAME - section 9. Same map as the list, so a
 *  campaign reads identically in both places. */
const STATUS_STYLE: Record<string, { variant: "muted" | "lilac" | "butter" | "outline" | "destructive" }> = {
  DRAFT:     { variant: "muted" },
  PLANNED:   { variant: "muted" },
  SCHEDULED: { variant: "butter" },
  ACTIVE:    { variant: "lilac" },
  PAUSED:    { variant: "butter" },
  COMPLETED: { variant: "outline" },
  CANCELLED: { variant: "destructive" },
  ARCHIVED:  { variant: "outline" },
};


/** The four states a line can actually reach today. approvals, live,
 *  delivered and reconciled are not modelled - see BRANDING.md section 9. */
const ITEM_STATUS: Record<string, { variant: "lilac" | "butter" | "muted" | "outline"; label: string }> = {
  SELECTED:  { variant: "muted",   label: "On plan" },
  CALLING:   { variant: "butter",  label: "Calling" },
  CONFIRMED: { variant: "lilac",   label: "Quoted" },
  DECLINED:  { variant: "outline", label: "Declined" },
  BOOKED:    { variant: "lilac",   label: "Booked" },
};

const ITEM_TONES: TunerTone[] = ["lilac", "blush", "butter", "muted"];

export interface PlanItem {
  id: string;
  kind: "STATION" | "CREATOR";
  name: string;
  channel: string | null;
  city: string | null;
  estCostPkr: number | null;
  estReach: number | null;
  externalId?: string;
  matchScore: number | null;
  rationale: string | null;
  recommendedSlots: string[];
  confirmedRatePkr: number | null;
  confirmedReach: number | null;
  availability: string | null;
  confirmedNotes: string | null;
  calls: {
    mock: boolean;
    outcome: string | null;
    rateConfirmed?: boolean | null;
    confidenceLabel?: string | null;
    evidence?: string[];
    calleCallId?: string | null;
    transcript?: unknown;
  }[];
  spots: number | null;
  bookedTotalPkr: number | null;
  bookedAt: Date | null;
  status: string;
}

export interface PlanScript {
  id: string;
  language: string;
  durationSec: number;
  title: string;
  hook: string;
  body: string;
  callToAction: string;
  bestTimeSlots: string[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  currency: string | null;
  flightStart: Date | null;
  flightEnd: Date | null;
  budgetTotal: number | null;
  durationDays: number | null;
  estStationCost: number | null;
  estInfluencerCost: number | null;
  estPlatformFee: number | null;
  estTotalCost: number | null;
  estTotalReach: number | null;
  items: PlanItem[];
  scripts: PlanScript[];
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

function Stat({ label, value, Icon, sub }: { label: string; value: string; Icon: typeof Users; sub?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-control bg-bone p-4">
      <Icon aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
      <span className={`font-display text-h2 leading-none ${value === "—" ? "text-text-muted" : "text-text"}`}>{value}</span>
      <span className="type-label text-text-muted">{label}</span>
      {sub && <span className="text-small text-text-muted">{sub}</span>}
    </div>
  );
}

export default function CampaignDetail({ campaign, brandName }: { campaign: CampaignSummary; brandName?: string | null }) {
  /* Derived, not read - see lib/campaign-status.ts. */
  const derived = deriveCampaignStatus({
    storedStatus: campaign.status,
    itemStatuses: campaign.items.map(i => i.status),
    flightStart: campaign.flightStart ?? null,
    flightEnd: campaign.flightEnd ?? null,
  });
  const status = STATUS_STYLE[derived.key] ?? STATUS_STYLE.DRAFT;
  const createdDate = new Date(campaign.createdAt).toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const cur = campaign.currency ?? "PKR";

  const stations = campaign.items.filter(i => i.kind === "STATION");
  const creators = campaign.items.filter(i => i.kind === "CREATOR");
  const hasPlan = campaign.items.length > 0 || campaign.scripts.length > 0;
  /* "Called" is any line CALL-E reached, including one that answered
     UNKNOWN. It is deliberately not called "verified": an UNKNOWN verdict
     means the call happened and settled nothing. */
  const called = campaign.items.filter(i => i.availability != null);
  const booked = campaign.items.filter(i => i.bookedAt != null);
  const bookedTotal = booked.reduce((sum, i) => sum + (i.bookedTotalPkr ?? 0), 0);

  /* Weighted by each line's estimated cost. Not "spend": nothing has been
     paid, and these are the plan's estimates rather than what was committed. */
  /* Everything buildTask wants, straight off the campaign - so a call placed
     here carries better context than the wizard's own did. */
  const callContext = {
    /* The advertiser is the brand, not the campaign. See lib/advertiser.ts -
       the dash decides, and the brand is the answer when there is no dash. */
    advertiser: advertiserName(campaign.name, brandName),
    campaignName: campaign.name,
    market: campaign.items[0]?.city ?? undefined,
    durationDays: campaign.durationDays ?? undefined,
    /* A bundle is only offered when there is genuinely something to bundle. */
    otherLines: Math.max(0, campaign.items.length - 1),
    budgetTotal: campaign.budgetTotal ?? undefined,
    currency: cur,
    flightStart: campaign.flightStart ? formatFlightDate(campaign.flightStart) : undefined,
    flightEnd: campaign.flightEnd ? formatFlightDate(campaign.flightEnd) : undefined,
  };

  const costSegments: TunerSegment[] = campaign.items
    .filter(i => (i.estCostPkr ?? 0) > 0)
    .map((i, idx) => ({
      id: i.id,
      label: i.name,
      caption: `${cur} ${((i.estCostPkr ?? 0) / 1000).toFixed(0)}K`,
      weight: i.estCostPkr ?? 1,
      tone: ITEM_TONES[idx % ITEM_TONES.length],
    }));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="flex min-w-0 items-center gap-3 font-display text-h1 text-text">
            <span className="truncate">{campaign.name}</span>
            <Badge variant={status.variant} title={derived.note}>{derived.label}</Badge>
          </h1>
          <p className="text-small text-text-muted">
            Created {createdDate}
            {/* Real dates when the brief captured them. Campaigns launched
                before the field existed keep the duration-only reading rather
                than getting a date invented for them. */}
            {campaign.flightStart && campaign.flightEnd
              ? ` · Runs ${formatFlightDate(campaign.flightStart)} – ${formatFlightDate(campaign.flightEnd)}`
              : campaign.durationDays
                ? ` · ${campaign.durationDays}-day flight`
                : ""}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/campaigns">
            <ArrowLeft aria-hidden strokeWidth={1.75} />
            All Campaigns
          </Link>
        </Button>
      </header>

      {/* The four figures the page has always promised. Three of them are real
          now that the plan is stored. Budget Used stays an em dash: nothing
          spends against a campaign yet, and a plausible number would be an
          invented one. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Combined audience" Icon={Users} value={fmt(campaign.estTotalReach)} />
        <Stat label="Budget Used" Icon={Wallet} value="—" sub="Not tracked yet" />
        <Stat label="Scripts" Icon={Mic} value={campaign.scripts.length ? String(campaign.scripts.length) : "—"} />
        <Stat label="Stations" Icon={Radio} value={stations.length ? String(stations.length) : "—"} />
      </div>

      {!hasPlan ? (
        /* Every campaign created before the plan was stored looks like this.
           No back-fill: a plan that was never captured is not one this page
           can reconstruct. */
        <Card>
          <CardHeader>
            <CardTitle>No media plan stored</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="max-w-prose text-body text-text-muted">
              This campaign was created before Arc began saving the approved plan, so its stations, creators and scripts were not recorded. Campaigns launched from the wizard now keep theirs.
            </p>
            <Button asChild variant="outline" className="w-fit">
              <Link href="/campaigns/create">Start a new campaign</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Budget</CardTitle>
              <CardDescription>
                {campaign.budgetTotal
                  ? `${cur} ${campaign.budgetTotal.toLocaleString()} approved at launch`
                  : "Approved at launch"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <dl className="flex flex-col">
                {[
                  ["Radio", campaign.estStationCost],
                  ["Influencer", campaign.estInfluencerCost],
                  ["Arc platform fee (10%)", campaign.estPlatformFee],
                  ["Total", campaign.estTotalCost],
                ].map(([label, value], i, arr) => (
                  <div
                    key={label as string}
                    className={`flex items-baseline justify-between gap-4 border-b border-hairline py-3 first:pt-0 last:border-0 last:pb-0 ${i === arr.length - 1 ? "font-medium" : ""}`}
                  >
                    <dt className={i === arr.length - 1 ? "text-small text-text" : "text-small text-text-muted"}>{label as string}</dt>
                    <dd className="type-data text-text">
                      {value == null ? "—" : `${cur} ${(value as number).toLocaleString()}`}
                    </dd>
                  </div>
                ))}
              </dl>

              {costSegments.length > 0 && (
                <TunerStrip segments={costSegments} label={`${campaign.name} estimated cost by line`} />
              )}
            </CardContent>
          </Card>

          {campaign.items.length > 0 && (
            <Card>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <CardTitle>Media Plan</CardTitle>
                  {/* One line of plan status rather than separate chips
                      competing for the same corner: called, booked and
                      committed are facets of the same sentence. */}
                  <CardDescription>
                    {stations.length} station{stations.length === 1 ? "" : "s"} · {creators.length} creator{creators.length === 1 ? "" : "s"} ·{" "}
                    {called.length} of {campaign.items.length} called · {booked.length} booked
                    {bookedTotal > 0 ? ` · ${cur} ${bookedTotal.toLocaleString()} committed` : ""}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <MediaPlanTable
                  campaignId={campaign.id}
                  currency={cur}
                  items={campaign.items}
                  context={callContext}
                />
              </CardContent>
            </Card>
          )}

          {campaign.scripts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Scripts</CardTitle>
                <CardDescription>As approved at launch</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {campaign.scripts.map(sc => (
                  <div key={sc.id} className="flex flex-col gap-3 rounded-control bg-bone p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-small font-medium text-text">{sc.title}</span>
                      <span className="flex flex-wrap gap-2">
                        <Badge variant="outline">{sc.language}</Badge>
                        <Badge variant="muted">{sc.durationSec}s</Badge>
                      </span>
                    </div>
                    <p className="max-w-prose text-body leading-relaxed text-text-muted">
                      <span className="font-medium text-text">{sc.hook}</span> {sc.body}
                    </p>
                    <p className="text-small text-text">{sc.callToAction}</p>
                    {sc.bestTimeSlots.length > 0 && (
                      <span className="flex flex-wrap gap-2">
                        {sc.bestTimeSlots.map(slot => <Badge key={slot} variant="lilac">{slot}</Badge>)}
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}

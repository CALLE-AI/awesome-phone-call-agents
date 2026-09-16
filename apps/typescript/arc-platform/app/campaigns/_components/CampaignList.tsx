"use client";

import Link from "next/link";
import { ChevronRight, Sparkles, Megaphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TunerStrip, type TunerSegment } from "@/components/ui/tuner-strip";
import { deriveCampaignStatus } from "@/lib/campaign-status";

/** Status tone as a token NAME, resolved here only - section 9. The old map
 *  held rgba() literals. */
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

interface Campaign {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  items?: { status: string }[];
  flightStart?: Date | null;
  flightEnd?: Date | null;
}

export default function CampaignList({
  campaigns,
  segments,
}: {
  campaigns: Campaign[];
  segments: TunerSegment[];
}) {
  if (campaigns.length === 0) {
    return (
      <section className="flex flex-col items-center gap-6 rounded-card bg-surface p-10 text-center shadow-card">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-h1 text-text">No campaigns yet</h2>
          <p className="text-body text-text-muted">
            Create your first AI-powered campaign in minutes.
          </p>
        </div>

        {/* The dial replaces a clipboard emoji: real stations, real
            frequencies, widths by daily listeners. Inventory waiting to be
            booked, rather than a picture of absence. */}
        {segments.length > 0 && (
          <div className="w-full max-w-2xl text-left">
            <TunerStrip segments={segments} label="Stations available to book" animateOnMount />
          </div>
        )}

        <Button asChild size="lg">
          <Link href="/campaigns/create">
            <Sparkles aria-hidden strokeWidth={1.75} />
            Create Campaign with AI
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {campaigns.map(campaign => {
        /* Derived, not read. See lib/campaign-status.ts - the stored value
           is written once at launch and never updated by anything. */
        const derived = deriveCampaignStatus({
          storedStatus: campaign.status,
          itemStatuses: (campaign.items ?? []).map(i => i.status),
          flightStart: campaign.flightStart ?? null,
          flightEnd: campaign.flightEnd ?? null,
        });
        const status = STATUS_STYLE[derived.key] ?? STATUS_STYLE.DRAFT;
        return (
          <li key={campaign.id}>
            <Link
              href={`/campaigns/${campaign.id}`}
              className="flex items-center justify-between gap-4 rounded-card bg-surface p-5 shadow-card outline-none transition-colors hover:bg-bone focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-lilac">
                  <Megaphone aria-hidden strokeWidth={1.75} className="size-5 text-ink" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-small font-medium text-text">{campaign.name}</span>
                  <span className="type-data text-text-muted">
                    Created {new Date(campaign.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-3">
                <Badge variant={status.variant} title={derived.note}>{derived.label}</Badge>
                <ChevronRight aria-hidden strokeWidth={2} className="size-4 text-text-muted" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

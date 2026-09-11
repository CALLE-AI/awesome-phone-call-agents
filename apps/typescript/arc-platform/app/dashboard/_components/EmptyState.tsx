"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TunerStrip, type TunerSegment } from "@/components/ui/tuner-strip";
import SampleCall, { type CallMoment } from "./SampleCall";
import { ArcLogo } from "@/components/ui/arc-logo";

const SECONDARY_LINKS = [
  { label: "Browse stations", href: "/radio" },
  { label: "Find influencers", href: "/influencers" },
  { label: "View pricing", href: "/settings/billing" },
];

/**
 * First-run dashboard. Section 7: an empty state is an invitation, not an
 * apology.
 *
 * The tuner strip is the same component the landing hero uses - not a fork -
 * doing its second job from section 5: real stations, real frequencies, widths
 * by daily listeners. It turns "you have nothing" into "here is the inventory
 * waiting for you".
 *
 * The CTA carries ?first=1, which only a zero-campaign surface can emit, so the
 * wizard offers "Skip for now" rather than "Back to campaigns".
 */
export default function EmptyState({
  firstName,
  segments,
  callMoment,
}: {
  firstName: string;
  segments: TunerSegment[];
  callMoment: CallMoment;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 font-sans">
      <section className="flex w-full max-w-2xl flex-col gap-6 overflow-hidden rounded-card bg-surface p-8 text-center shadow-card">
        <ArcLogo className="h-7 w-auto text-text" gradientId="arc-logo-empty" />

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-h1 text-text">
            Your first campaign is one brief away
          </h2>
          <p className="text-body text-text-muted">
            Tell Arc what you&apos;re promoting. Arc phones the stations and the
            creators, gets you real rates, and hands back a ranked media plan.
          </p>
        </div>

        {/* Real inventory, sitting there waiting. */}
        {segments.length > 0 && (
          <div className="flex flex-col gap-2 text-left">
            <TunerStrip
              segments={segments}
              label="Stations available to book"
              animateOnMount
            />
          </div>
        )}

        <Button asChild size="lg" className="w-full">
          <Link href="/campaigns/create?first=1">
            Create my first campaign
            <ArrowRight aria-hidden strokeWidth={1.75} />
          </Link>
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {SECONDARY_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-control text-small font-medium text-text underline underline-offset-4 outline-none transition-colors hover:text-text-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </section>

      <div className="w-full max-w-2xl">
        <SampleCall moment={callMoment} />
      </div>
    </div>
  );
}

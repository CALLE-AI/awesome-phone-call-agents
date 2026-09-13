import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * With no campaigns there is nothing to report on, so the page invites rather
 * than showing illustrative numbers (section 7, and the section 9 standing
 * rule). No tuner strip here: the strip has to carry real data, and at zero
 * campaigns there is none - a decorative one on an analytics page would be
 * exactly the wrong signal.
 */
export default function AnalyticsEmpty() {
  return (
    <section className="flex flex-col items-center gap-6 rounded-card bg-surface p-10 text-center shadow-card">
      <span className="flex size-14 items-center justify-center rounded-pill bg-lilac">
        <BarChart3 aria-hidden strokeWidth={1.75} className="size-6 text-ink" />
      </span>
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-h1 text-text">Nothing to report yet</h1>
        <p className="max-w-md text-body text-text-muted">
          Run your first campaign and Arc will report its budget, bookings and
          planned reach across radio and creators here.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/campaigns/create?first=1">
          Create my first campaign
          <ArrowRight aria-hidden strokeWidth={1.75} />
        </Link>
      </Button>
    </section>
  );
}

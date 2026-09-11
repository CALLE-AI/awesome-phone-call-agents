import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Campaigns exist, but none of them carries a plan.
 *
 * This is what most brands see: every campaign they have predates the wizard
 * storing its media plan, so there is nothing to report on. Showing a page of
 * zeros would be technically true and useless, and would read as broken.
 */
export default function AnalyticsNoPlanData({ campaignCount }: { campaignCount: number }) {
  return (
    <section className="flex flex-col items-center gap-6 rounded-card bg-surface p-10 text-center shadow-card">
      <span className="flex size-14 items-center justify-center rounded-pill bg-lilac">
        <BarChart3 aria-hidden strokeWidth={1.75} className="size-6 text-ink" />
      </span>
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-h1 text-text">Nothing to report yet</h1>
        <p className="max-w-md text-body text-text-muted">
          Your {campaignCount === 1 ? "campaign was" : `${campaignCount} campaigns were`} created before Arc
          started saving the approved media plan, so there are no budgets or bookings to report on.
          Reporting starts with the next campaign you launch from the wizard.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/campaigns/create">
          Create a campaign
          <ArrowRight aria-hidden strokeWidth={1.75} />
        </Link>
      </Button>
    </section>
  );
}

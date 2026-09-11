"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart, FunnelBars, LineChart } from "./charts";
import {
  formatDuration,
  pct,
  parseRange,
  SPEED_TO_RING_SLA_SEC,
  SQD_HINT,
  type Range,
  withRange
} from "./format";
import { AnimatedNumber } from "./AnimatedNumber";
import { InsightBars, KpiCard, RangePicker, cardHeadingClass, insightHeadingClass } from "./ui";
import { useConsoleData } from "./useConsoleData";
import type { AnalyticsSnapshot, DataSource, LeadQueueItem, SundialCallRecord } from "@/lib/types";

export function HomeDashboard({
  initial
}: {
  initial?: {
    calls: SundialCallRecord[];
    leads: LeadQueueItem[];
    analytics: AnalyticsSnapshot;
    source: DataSource;
  };
}) {
  const params = useSearchParams();
  const router = useRouter();
  const range = parseRange(params.get("range"));
  const { analytics, source } = useConsoleData(initial, range);

  const setRange = (next: Range) => {
    router.replace(withRange("/app/home", next));
  };

  const pickupRate = pct(analytics.kpis.callsCompleted, analytics.kpis.callsRequested);
  const sqdRate = pct(analytics.kpis.salesQualifiedLeads, analytics.kpis.callsCompleted);
  const sla = analytics.kpis.avgResponseTimeSec;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          {source === "mock" ? <Badge variant="secondary">Mock overlay</Badge> : null}
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Avg Speed-to-Ring"
          value={sla ? formatDuration(sla) : "—"}
          bar={sla ? Math.min(100, (sla / SPEED_TO_RING_SLA_SEC) * 100) : undefined}
          barCaption={sla ? `${formatDuration(SPEED_TO_RING_SLA_SEC)} SLA` : undefined}
          detail={sla ? undefined : "No completed calls yet"}
        />
        <KpiCard
          label="High-Intent Inbound"
          value={<AnimatedNumber value={analytics.kpis.highIntentLeads} />}
          detail={
            <>
              <AnimatedNumber value={analytics.kpis.inboundLeads} /> identified leads
            </>
          }
        />
        <KpiCard
          label="AI Calls Completed"
          value={
            <>
              <AnimatedNumber value={analytics.kpis.callsCompleted} />
              {" / "}
              <AnimatedNumber value={analytics.kpis.callsRequested} />
            </>
          }
          detail={`${pickupRate} pickup rate`}
        />
        <KpiCard
          label="Sales Qualified Deals"
          hint={SQD_HINT}
          value={<AnimatedNumber value={analytics.kpis.salesQualifiedLeads} />}
          detail={`${sqdRate} of connected · avg opp ${analytics.kpis.avgOpportunityScore || "—"}`}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-visible [--card-spacing:1.5rem]">
          <CardHeader className="border-b">
            <CardTitle className={cardHeadingClass}>
              Inbound over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart series={analytics.series} />
          </CardContent>
        </Card>
        <Card className="overflow-visible [--card-spacing:1.5rem]">
          <CardHeader className="border-b">
            <CardTitle className={cardHeadingClass}>
              Funnel conversion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelBars analytics={analytics} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <InsightBars
          title="Top inbound pain points"
          titleClassName={insightHeadingClass}
          tickFontSize={14}
          items={analytics.intelligence.topPainPoints}
        />
        <Card className="overflow-visible [--card-spacing:1.5rem]">
          <CardHeader className="border-b">
            <CardTitle className={insightHeadingClass}>
              Company size
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart items={analytics.intelligence.companySizeDistribution} title="Company size" />
          </CardContent>
        </Card>
        <InsightBars
          title="Purchase horizon"
          titleClassName={insightHeadingClass}
          tickFontSize={14}
          items={analytics.intelligence.timelines}
        />
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <InsightBars title="Incumbent competitors" items={analytics.intelligence.competitors} />
        <InsightBars title="Objections" items={analytics.intelligence.objections} />
      </section>
    </>
  );
}

"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from "@/components/ui/chart";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnalyticsSnapshot, CountBucket, DailyPoint } from "@/lib/types";
import { FUNNEL } from "./format";

const lineConfig = {
  visitors: { label: "Visitors", color: "var(--chart-1)" },
  highIntent: { label: "High intent", color: "var(--chart-2)" },
  calls: { label: "Calls", color: "var(--chart-3)" }
} satisfies ChartConfig;

const barConfig = {
  count: { label: "Count", color: "var(--chart-1)" }
} satisfies ChartConfig;

export function LineChart({ series }: { series: DailyPoint[] }) {
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">No time series yet.</p>;
  }
  const drawKey = series.map((d) => d.date).join(",");
  return (
    <ChartContainer
      key={drawKey}
      config={lineConfig}
      className="h-[280px] w-full"
      initialDimension={{ width: 640, height: 280 }}
    >
      <RechartsLineChart accessibilityLayer data={series} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: string) => value.slice(5)}
        />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          type="monotone"
          dataKey="visitors"
          stroke="var(--color-visitors)"
          strokeWidth={2.5}
          dot={false}
          animationDuration={900}
          animationBegin={0}
        />
        <Line
          type="monotone"
          dataKey="highIntent"
          stroke="var(--color-highIntent)"
          strokeWidth={2.5}
          dot={false}
          animationDuration={900}
          animationBegin={120}
        />
        <Line
          type="monotone"
          dataKey="calls"
          stroke="var(--color-calls)"
          strokeWidth={2.5}
          dot={false}
          animationDuration={900}
          animationBegin={240}
        />
      </RechartsLineChart>
    </ChartContainer>
  );
}

function HorizontalBars({
  items,
  empty,
  tickFontSize = 12
}: {
  items: { label: string; count: number }[];
  empty: string;
  tickFontSize?: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  const height = Math.max(200, items.length * 48);
  const axisWidth = tickFontSize > 12 ? 148 : 118;
  return (
    <ChartContainer
      config={barConfig}
      className="w-full"
      style={{ height }}
      initialDimension={{ width: 480, height }}
    >
      <BarChart accessibilityLayer data={items} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={axisWidth}
          tick={{ fontSize: tickFontSize }}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} animationDuration={800}>
          <LabelList dataKey="count" position="right" className="fill-muted-foreground" fontSize={tickFontSize > 12 ? 13 : 11} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function FunnelStageLabel({ stage }: { stage: (typeof FUNNEL)[number] }) {
  const label = (
    <span className="text-xs leading-tight">
      <span className="text-muted-foreground">{stage.n}</span> {stage.title}
    </span>
  );
  if (!stage.hint) return label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1 text-left cursor-help"
          aria-label={`About ${stage.title}`}
        >
          {label}
          <CircleHelp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-pretty">
        {stage.hint}
      </TooltipContent>
    </Tooltip>
  );
}

export function FunnelBars({ analytics }: { analytics: AnalyticsSnapshot }) {
  const counts = FUNNEL.map((stage) => analytics.funnel[stage.key]);
  if (counts.every((count) => count === 0)) {
    return <p className="text-sm text-muted-foreground">No funnel traffic yet.</p>;
  }
  const max = Math.max(1, ...counts);
  return (
    <ol className="space-y-2.5">
      {FUNNEL.map((stage) => {
        const count = analytics.funnel[stage.key];
        const width = count > 0 ? Math.max(6, (count / max) * 100) : 0;
        return (
          <li key={stage.key} className="grid grid-cols-[11.5rem_minmax(0,1fr)_2rem] items-center gap-3">
            <FunnelStageLabel stage={stage} />
            <div className="h-4 overflow-hidden rounded-sm bg-muted">
              <div className="h-full rounded-sm bg-chart-1" style={{ width: `${width}%` }} />
            </div>
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">{count}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function InsightChart({ items, tickFontSize }: { items: CountBucket[]; tickFontSize?: number }) {
  return <HorizontalBars items={items} empty="No call intelligence yet." tickFontSize={tickFontSize} />;
}

export function DonutChart({ items, title }: { items: CountBucket[]; title: string }) {
  if (items.reduce((n, item) => n + item.count, 0) === 0) {
    return <p className="text-sm text-muted-foreground">No {title.toLowerCase()} yet.</p>;
  }
  const pieConfig = {
    count: { label: title },
    ...Object.fromEntries(
      items.map((item, i) => [
        `slice${i}`,
        { label: item.label, color: `var(--chart-${(i % 5) + 1})` }
      ])
    )
  } satisfies ChartConfig;
  const pieData = items.map((item, i) => {
    const color = `var(--chart-${(i % 5) + 1})`;
    return {
      key: `slice${i}`,
      label: item.label,
      count: item.count,
      fill: color
    };
  });
  return (
    <div className="flex flex-col items-center gap-4">
      <ChartContainer
        config={pieConfig}
        className="mx-auto aspect-square h-[220px] w-[220px]"
        initialDimension={{ width: 220, height: 220 }}
      >
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" hideLabel />} />
          <Pie
            data={pieData}
            dataKey="count"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={88}
            strokeWidth={2}
            animationDuration={800}
          >
            {pieData.map((entry) => (
              <Cell key={entry.key} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {pieData.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-sm text-foreground">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.fill }} aria-hidden />
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

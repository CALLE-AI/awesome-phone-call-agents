"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Fragment, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InsightChart } from "./charts";
import type { Range } from "./format";

const rangeItemClass =
  "hover:bg-primary/10 hover:text-primary data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-primary";

export const cardHeadingClass = "text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase";
export const insightHeadingClass = "text-lg font-semibold tracking-tight text-foreground";
export const fieldLabelClass = "text-base font-semibold tracking-tight text-foreground";

export function RangePicker({ value, onChange }: { value: Range; onChange: (next: Range) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => {
        if (next === "today" || next === "7d" || next === "30d") onChange(next);
      }}
      spacing={0}
    >
      <ToggleGroupItem value="today" className={rangeItemClass}>
        Today
      </ToggleGroupItem>
      <ToggleGroupItem value="7d" className={rangeItemClass}>
        Last 7D
      </ToggleGroupItem>
      <ToggleGroupItem value="30d" className={rangeItemClass}>
        30D
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function KpiCard({
  label,
  hint,
  value,
  detail,
  bar,
  barCaption
}: {
  label: string;
  hint?: string;
  value: ReactNode;
  detail?: ReactNode;
  bar?: number;
  barCaption?: string;
}) {
  const showBar = typeof bar === "number" && barCaption;
  return (
    <Card className="flex h-full flex-col [--card-spacing:1.5rem]">
      <CardHeader className="gap-3 border-b">
        <CardTitle className={cardHeadingClass}>
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 cursor-help uppercase"
                  aria-label={`About ${label}`}
                >
                  {label}
                  <CircleHelp className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-pretty">{hint}</TooltipContent>
            </Tooltip>
          ) : (
            label
          )}
        </CardTitle>
        <div className="text-3xl font-semibold tabular-nums leading-none tracking-tight">{value}</div>
      </CardHeader>
      <CardContent className="flex flex-1 items-center">
        {showBar ? (
          <div className="flex w-full items-center gap-3">
            <Progress
              value={bar}
              className="h-2 flex-1"
              aria-label={`${label}: ${barCaption}`}
            />
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{barCaption}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function InsightBars({
  title,
  items,
  titleClassName,
  tickFontSize
}: {
  title: string;
  items: { label: string; count: number }[];
  titleClassName?: string;
  tickFontSize?: number;
}) {
  return (
    <Card className="overflow-visible [--card-spacing:1.5rem]">
      <CardHeader className="border-b">
        <CardTitle className={titleClassName || cardHeadingClass}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <InsightChart items={items} tickFontSize={tickFontSize} />
      </CardContent>
    </Card>
  );
}

export function ConsoleBreadcrumb({
  items
}: {
  items: Array<{ href?: string; label: string }>;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {item.href ? (
                <BreadcrumbLink asChild>
                  <Link href={item.href}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="font-medium">{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function FieldLabel({
  as: Comp = "div",
  className,
  children
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <Comp className={cn(fieldLabelClass, className)}>{children}</Comp>;
}

export function FactGrid({
  facts,
  className
}: {
  facts: Array<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  if (facts.length === 0) return null;
  return (
    <dl className={cn("grid gap-x-8 gap-y-5 text-base md:grid-cols-2", className)}>
      {facts.map((fact) => (
        <div key={String(fact.label)} className="min-w-0 space-y-1.5">
          <dt className={fieldLabelClass}>{fact.label}</dt>
          <dd className="leading-relaxed text-muted-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NextActionsList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <span className="leading-relaxed text-muted-foreground">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function ConsoleEmpty({
  title,
  detail,
  action
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-medium tracking-tight">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function EntityNotFound({ kind }: { kind: string }) {
  return (
    <Card className="[--card-spacing:2rem]">
      <CardHeader className="gap-2">
        <CardTitle className="text-xl">{kind} not found</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          It may not exist yet, or Harbor traffic has not produced this record.
        </p>
      </CardContent>
    </Card>
  );
}

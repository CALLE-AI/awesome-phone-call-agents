"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  avatarTone,
  callForLead,
  companyLabel,
  contactLabel,
  defaultLeadSortDirection,
  initials,
  leadPath,
  leadProfileSummary,
  leadStatusSearchText,
  leadStatusSummary,
  sortLeadQueue,
  type HeatTab,
  type LeadTableSortKey,
  type SortDirection,
  warmthHeadline,
  warmthWidth
} from "./format";
import { useConsoleData } from "./useConsoleData";
import { ConsoleEmpty } from "./ui";
import type { AnalyticsSnapshot, LeadQueueItem, SundialCallRecord } from "@/lib/types";

const heatPillClass =
  "h-8 rounded-full border-border px-3 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-primary";

function SortableHead({
  column,
  label,
  active,
  direction,
  onSort
}: {
  column: LeadTableSortKey;
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort: (column: LeadTableSortKey) => void;
}) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className="px-6 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="-mx-1 inline-flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <Icon className={`size-3.5 ${active ? "text-foreground" : "text-muted-foreground/70"}`} aria-hidden />
        <span className="sr-only">
          {active ? `Sorted ${direction === "asc" ? "ascending" : "descending"}` : "Not sorted"}
        </span>
      </button>
    </TableHead>
  );
}

export function LeadsInbox({
  initial
}: {
  initial?: { calls: SundialCallRecord[]; leads: LeadQueueItem[]; analytics: AnalyticsSnapshot };
}) {
  const router = useRouter();
  const { calls, leads, isLoading } = useConsoleData(initial);
  const [heat, setHeat] = useState<HeatTab>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<LeadTableSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const filteredLeads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (heat === "very_high" && lead.priority !== "very_high") return false;
      if (heat === "high" && lead.priority !== "high") return false;
      if (heat === "nurture" && lead.priority !== "nurture" && lead.priority !== "disqualified") return false;
      if (heat === "followup") {
        const wants = lead.opportunity?.wantsHumanFollowUp?.value;
        const inflight = lead.latestCallStatus && ["queued", "dialing", "in_progress"].includes(lead.latestCallStatus);
        if (!wants && !inflight) return false;
      }
      if (!q) return true;
      const blob = [
        companyLabel(lead),
        contactLabel(lead),
        lead.lead.email,
        leadProfileSummary(lead),
        leadStatusSearchText(lead)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [leads, heat, query]);

  const visibleLeads = useMemo(
    () => sortLeadQueue(filteredLeads, sortKey, sortDir, calls),
    [filteredLeads, sortKey, sortDir, calls]
  );

  const toggleSort = (column: LeadTableSortKey) => {
    if (sortKey !== column) {
      setSortKey(column);
      setSortDir(defaultLeadSortDirection(column));
      return;
    }
    setSortDir((current) => (current === "asc" ? "desc" : "asc"));
  };

  const veryHigh = leads.filter((l) => l.priority === "very_high").length;
  const high = leads.filter((l) => l.priority === "high").length;
  const followups = leads.filter((l) => l.opportunity?.wantsHumanFollowUp?.value).length;
  const nurture = leads.filter((l) => l.priority === "nurture").length;

  const heatFilters: Array<{ value: HeatTab; label: string; count: number }> = [
    { value: "all", label: "All Leads", count: leads.length },
    { value: "very_high", label: "Very High Heat", count: veryHigh },
    { value: "high", label: "High", count: high },
    { value: "followup", label: "Needs Follow-Up", count: followups },
    { value: "nurture", label: "Nurture", count: nurture }
  ];

  const openLead = (visitorId: string) => {
    router.push(leadPath(visitorId));
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            value={heat}
            onValueChange={(next) => {
              if (
                next === "all" ||
                next === "very_high" ||
                next === "high" ||
                next === "followup" ||
                next === "nurture"
              ) {
                setHeat(next);
              }
            }}
            className="max-w-full flex-wrap justify-start bg-transparent"
            aria-label="Filter leads by heat"
          >
            {heatFilters.map((filter) => (
              <ToggleGroupItem key={filter.value} value={filter.value} className={heatPillClass}>
                {filter.label}
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 rounded-full px-1.5 font-medium tabular-nums group-data-[state=on]/toggle:bg-primary/20 group-data-[state=on]/toggle:text-primary"
                >
                  {filter.count}
                </Badge>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search companies, contacts…"
              aria-label="Search leads"
              className="h-9 bg-background pr-9 pl-8 shadow-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <Card className="overflow-hidden py-0 [--card-spacing:0]">
        <CardContent className="p-0">
          <Table className="min-w-[800px]">
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <SortableHead
                  column="company"
                  label="Company & contact"
                  active={sortKey === "company"}
                  direction={sortDir}
                  onSort={toggleSort}
                />
                <SortableHead
                  column="warmth"
                  label="Warmth"
                  active={sortKey === "warmth"}
                  direction={sortDir}
                  onSort={toggleSort}
                />
                <SortableHead
                  column="profile"
                  label="Profile"
                  active={sortKey === "profile"}
                  direction={sortDir}
                  onSort={toggleSort}
                />
                <SortableHead
                  column="status"
                  label="Lead status"
                  active={sortKey === "status"}
                  direction={sortDir}
                  onSort={toggleSort}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <ConsoleEmpty title="Loading leads" detail="Pulling the live conversion feed…" />
                  </TableCell>
                </TableRow>
              ) : visibleLeads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <ConsoleEmpty
                      title="No leads in this view"
                      detail="Open Harbor, allow intent tracking, then Talk to sales."
                      action={
                        <a
                          href="/demo"
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Open Harbor demo
                        </a>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                visibleLeads.map((lead) => {
                  const call = callForLead(lead, calls);
                  const status = leadStatusSummary(lead, call);
                  const profile = leadProfileSummary(lead);
                  const hot = lead.priority === "very_high" || lead.priority === "high";
                  return (
                    <TableRow
                      key={lead.visitorId}
                      className="cursor-pointer"
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${companyLabel(lead)}`}
                      onClick={() => openLead(lead.visitorId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openLead(lead.visitorId);
                        }
                      }}
                    >
                      <TableCell className="px-6 py-4 whitespace-normal">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback
                              className="font-bold text-white"
                              style={{ background: avatarTone(lead.visitorId) }}
                            >
                              {initials(lead)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="text-base font-semibold tracking-tight">{companyLabel(lead)}</div>
                            <div className="text-sm text-muted-foreground">
                              {contactLabel(lead)}
                              <span className="text-muted-foreground/80"> · {lead.lead.email || "no email"}</span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="w-48 px-6 py-4 whitespace-normal">
                        <Progress
                          value={warmthWidth(lead.intent.score)}
                          className={hot ? "h-2" : "h-2 [&_[data-slot=progress-indicator]]:bg-chart-2"}
                        />
                        <div className="mt-1.5 text-xs font-medium">
                          {warmthHeadline(lead.intent.score, lead.priority)}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 whitespace-normal">
                        <p className="line-clamp-3 max-w-md text-sm leading-snug text-muted-foreground" title={profile}>
                          {profile}
                        </p>
                      </TableCell>
                      <TableCell className="px-6 py-4 whitespace-normal">
                        <div className="max-w-sm text-sm leading-snug">
                          <div className="font-medium">{status.headline}</div>
                          <div className="text-muted-foreground">{status.detail}</div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

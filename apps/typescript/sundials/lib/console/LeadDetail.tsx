"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadQueueItem, SundialCallRecord } from "@/lib/types";
import {
  avatarTone,
  callJourneyBlurb,
  callPath,
  callStatusLabel,
  callWhenIso,
  callWhenLabel,
  companyLabel,
  contactLabel,
  formatChipLabel,
  formatDateOnly,
  formatDuration,
  initials,
  leadDiscoveryFacts,
  leadStatusSummary,
  pageEngagementRows,
  sortCallsForJourney,
  splitDiscoveryFacts,
  uniqueIntentSignals,
  warmthHeadline
} from "./format";
import { ConsoleBreadcrumb, ConsoleEmpty, EntityNotFound, FactGrid, FieldLabel, NextActionsList, cardHeadingClass } from "./ui";

export function LeadDetail({
  leadId,
  initialLead,
  initialCalls
}: {
  leadId: string;
  initialLead?: LeadQueueItem | null;
  initialCalls?: SundialCallRecord[];
}) {
  const [lead, setLead] = useState<LeadQueueItem | null>(initialLead ?? null);
  const [calls, setCalls] = useState<SundialCallRecord[]>(initialCalls ?? []);
  const [missing, setMissing] = useState(initialLead === null);
  const [isLoading, setIsLoading] = useState(initialLead === undefined);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/sundials/console/leads/${encodeURIComponent(leadId)}`);
        if (res.status === 404) {
          setMissing(true);
          setLead(null);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        setMissing(false);
        if (data.lead) setLead(data.lead);
        if (data.calls) setCalls(data.calls);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    void load();
    const interval = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(interval);
  }, [leadId]);

  if (isLoading && !lead) {
    return (
      <Card className="text-base [--card-spacing:2rem]">
        <CardContent className="text-muted-foreground">Loading lead intelligence…</CardContent>
      </Card>
    );
  }
  if (missing || !lead) {
    return <EntityNotFound kind="Lead" />;
  }

  const latest = calls.find((c) => c.id === lead.latestCallId) || calls[0];
  const status = leadStatusSummary(lead, latest);
  const facts = leadDiscoveryFacts(lead);
  const { narrative, meta } = splitDiscoveryFacts(facts);
  const pages = pageEngagementRows(lead.behavior);
  const signals = uniqueIntentSignals(lead.intent.signals);
  const journey = sortCallsForJourney(calls);

  return (
    <div className="space-y-6 text-base">
      <ConsoleBreadcrumb items={[{ href: "/app/leads", label: "Leads" }, { label: companyLabel(lead) }]} />

      <Card className="text-base [--card-spacing:2rem]">
        <CardHeader className={facts.length ? "border-b" : undefined}>
          <div className="flex items-center gap-4">
            <Avatar size="lg" className="size-16 data-[size=lg]:size-16">
              <AvatarFallback className="text-xl font-semibold text-white" style={{ background: avatarTone(lead.visitorId) }}>
                {initials(lead)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="text-2xl tracking-tight">{companyLabel(lead)}</CardTitle>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {contactLabel(lead)} · {lead.lead.email || "no email"}
              </p>
            </div>
          </div>
          <CardAction className="space-y-1.5 text-right">
            <div className="text-sm font-semibold text-accent-foreground">{warmthHeadline(lead.intent.score, lead.priority)}</div>
            <Badge variant="outline" className="font-medium">
              {status.headline}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-8">
          {facts.length === 0 ? (
            <p className="text-muted-foreground">
              No discovery notes yet. Use case, pain, and next steps appear here after a completed CALL-E call.
            </p>
          ) : (
            <div className="space-y-6">
              <FactGrid facts={meta} />
              {narrative.map((fact) => (
                <section key={fact.label} className="space-y-2">
                  <FieldLabel as="h3">{fact.label}</FieldLabel>
                  {fact.label === "Next for sales" ? (
                    <NextActionsList items={fact.value.split(" · ")} />
                  ) : (
                    <p className="leading-relaxed text-muted-foreground">{fact.value}</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid items-stretch gap-6 md:grid-cols-[65fr_35fr]">
        <Card className="h-full text-base [--card-spacing:1.5rem]">
          <CardHeader className="border-b">
            <CardTitle className={cardHeadingClass}>Page visit</CardTitle>
          </CardHeader>
          <CardContent>
            {pages.length === 0 ? (
              <p className="text-muted-foreground">No page engagement recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">Page</TableHead>
                    <TableHead className="w-28 text-xs font-medium tracking-wide text-muted-foreground uppercase">Pointer</TableHead>
                    <TableHead className="w-16 pr-0 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">Views</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map((page) => (
                    <TableRow key={page.path}>
                      <TableCell className="pl-0">
                        <div className="font-medium">{page.path}</div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${page.barPct}%` }} />
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {page.hoverSec > 0 ? formatDuration(page.hoverSec) : "—"}
                      </TableCell>
                      <TableCell className="pr-0 text-right tabular-nums">{page.views || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-full text-base [--card-spacing:1.5rem]">
          <CardHeader className="border-b">
            <CardTitle className={cardHeadingClass}>Intent signals</CardTitle>
          </CardHeader>
          <CardContent>
            {signals.length === 0 ? (
              <p className="text-muted-foreground">No intent signals yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {signals.map((signal) => (
                  <Badge key={`${signal.type}:${signal.source}`} variant="secondary">
                    {formatChipLabel(signal.type)}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="text-base [--card-spacing:1.5rem]">
        <CardHeader className="border-b">
          <CardTitle className={cardHeadingClass}>Interaction timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {journey.length === 0 ? (
            <ConsoleEmpty title="No calls yet" detail="A CALL-E dispatch for this lead will show up here." />
          ) : (
            <ol className="relative ml-1 border-l border-border">
              {journey.map((call) => {
                const when = callWhenIso(call);
                const duration = formatDuration(call.durationSec);
                const ring = call.speedToDialSec ? `${formatDuration(call.speedToDialSec)} to ring` : "";
                return (
                  <li key={call.id} className="relative pb-7 pl-6 last:pb-0">
                    <span className="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-primary ring-4 ring-card" />
                    <Link
                      href={callPath(call.id)}
                      className="-mx-2 -mt-1 block rounded-lg px-2 py-1 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="text-xs text-muted-foreground">{formatDateOnly(when) || callWhenLabel(call)}</div>
                      <div className="mt-1 font-medium">{callStatusLabel(call.status)}</div>
                      <p className="mt-1 text-sm leading-snug text-muted-foreground">{callJourneyBlurb(call)}</p>
                      {ring || duration ? (
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          {[ring, duration].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

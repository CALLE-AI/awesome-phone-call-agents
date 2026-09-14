"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { companyLabel, formatHoverByPath, leadPath } from "./format";
import { cardHeadingClass } from "./ui";
import { useConsoleData } from "./useConsoleData";
import type { LeadQueueItem } from "@/lib/types";

export function TelemetryPanel({ initialLeads }: { initialLeads?: LeadQueueItem[] }) {
  const { leads, isLoading } = useConsoleData(initialLeads ? { leads: initialLeads } : undefined);

  return (
    <Card className="[--card-spacing:1.5rem]">
      <CardHeader className="gap-2 border-b">
        <CardTitle className={cardHeadingClass}>
          Concierge telemetry
        </CardTitle>
        <CardDescription>
          Page views and pointer-over time after the visitor allows intent tracking. No clickstream recitation on the
          call.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <p className="px-6 text-sm text-muted-foreground">Loading visitor sessions…</p>
        ) : leads.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">No visitor sessions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-6">Visitor</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Pointer time</TableHead>
                <TableHead className="px-6">Intent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.visitorId}>
                  <TableCell className="px-6 whitespace-normal">
                    <Link href={leadPath(lead.visitorId)} className="hover:underline">
                      {lead.lead.company?.trim() || lead.lead.email || companyLabel(lead)}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">{lead.behavior.pagesViewed.join(", ") || "—"}</TableCell>
                  <TableCell className="whitespace-normal">
                    {formatHoverByPath(lead.behavior.hoverSecByPath) || "—"}
                  </TableCell>
                  <TableCell className="px-6">
                    {lead.intent.score} ({lead.intent.level})
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

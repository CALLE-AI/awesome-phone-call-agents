"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LeadQueueItem, SundialCallRecord } from "@/lib/types";
import {
  callStatusLabel,
  callTranscriptBaseIso,
  callWhenLabel,
  companyLabel,
  contactLabel,
  displayField,
  formatDateTime,
  formatDuration,
  formatTranscriptOffset,
  leadPath,
  transcriptSpeakerName
} from "./format";
import { ConsoleBreadcrumb, EntityNotFound, cardHeadingClass } from "./ui";

export function CallDossier({
  callId,
  initialCall,
  initialLead,
  initialAgentIdentity,
  initialProductName
}: {
  callId: string;
  initialCall?: SundialCallRecord | null;
  initialLead?: LeadQueueItem | null;
  initialAgentIdentity?: string;
  initialProductName?: string;
}) {
  const [call, setCall] = useState<SundialCallRecord | null>(initialCall ?? null);
  const [lead, setLead] = useState<LeadQueueItem | null>(initialLead ?? null);
  const [agentIdentity, setAgentIdentity] = useState(initialAgentIdentity);
  const [productName, setProductName] = useState(initialProductName);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [missing, setMissing] = useState(initialCall === null);
  const [isLoading, setIsLoading] = useState(initialCall === undefined);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/sundials/console/calls/${encodeURIComponent(callId)}`);
        if (res.status === 404) {
          setMissing(true);
          setCall(null);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        setMissing(false);
        if (data.call) setCall(data.call);
        setLead(data.lead || null);
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
  }, [callId]);

  useEffect(() => {
    const loadBrain = async () => {
      try {
        const res = await fetch("/api/sundials/console/brain");
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.config?.agentIdentity === "string") setAgentIdentity(data.config.agentIdentity);
        if (typeof data.config?.productName === "string") setProductName(data.config.productName);
        setGeminiConfigured(Boolean(data.geminiConfigured));
      } catch {
        // keep SSR / fallback labels
      }
    };
    void loadBrain();
  }, []);

  if (isLoading && !call) {
    return (
      <Card className="[--card-spacing:2rem]">
        <CardContent className="text-muted-foreground">Loading call details…</CardContent>
      </Card>
    );
  }
  if (missing || !call) {
    return <EntityNotFound kind="Call" />;
  }

  const company = call.company?.trim() || (lead ? companyLabel(lead) : "") || "Unknown company";
  const contact = call.contactName?.trim() || (lead ? contactLabel(lead) : "No point of contact");
  const email = call.contactEmail || lead?.lead.email || "no email";
  const summary = displayField(call.opportunityProfile?.callSummary?.value);
  const pending =
    geminiConfigured &&
    call.status === "completed" &&
    Boolean(call.fullTranscript?.trim() || call.transcript?.some((entry) => entry.text.trim())) &&
    summary === "—";

  return (
    <div className="space-y-6">
      <ConsoleBreadcrumb
        items={[
          { href: "/app/leads", label: "Leads" },
          ...(call.visitorId ? [{ href: leadPath(call.visitorId), label: company }] : []),
          { label: "Call details" }
        ]}
      />

      <Card className="[--card-spacing:2rem]">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="text-2xl tracking-tight">{company}</CardTitle>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {contact} · {email}
            </p>
          </div>
          <CardAction className="flex max-w-xs flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Badge variant="secondary">{callStatusLabel(call.status)}</Badge>
            <span>{callWhenLabel(call)}</span>
            <span>{call.speedToDialSec ? `${formatDuration(call.speedToDialSec)} to ring` : "pending ring"}</span>
            {call.endedAt ? <span>Ended {formatDateTime(call.endedAt)}</span> : null}
            <span className="tabular-nums">{formatDuration(call.durationSec) || "—"} duration</span>
          </CardAction>
        </CardHeader>
        {call.errorReason ? (
          <CardContent>
            <p className="text-sm text-destructive">{call.errorReason}</p>
          </CardContent>
        ) : null}
      </Card>

      {pending || summary !== "—" ? (
        <Card className="[--card-spacing:1.5rem]">
          <CardHeader className="border-b">
            <CardTitle className={cardHeadingClass}>What this call was about</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base leading-7 text-foreground">
              {pending ? "Gemini Flash is writing a summary from this transcript…" : summary}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="[--card-spacing:1.5rem]">
        <CardHeader className="border-b">
          <CardTitle className={cardHeadingClass}>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[28rem] rounded-lg bg-muted/40">
            <div className="space-y-4 p-4">
              {call.transcript && call.transcript.length > 0 ? (
                call.transcript.map((item, idx) => {
                  const offset = formatTranscriptOffset(item.timestamp, callTranscriptBaseIso(call));
                  const speaker = transcriptSpeakerName(item.speaker, {
                    contactName: call.contactName,
                    leadName: lead?.lead.name,
                    agentIdentity,
                    productName
                  });
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 text-[15px] leading-relaxed"
                    >
                      <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{offset || "\u00a0"}</span>
                      <p className="min-w-0 text-foreground">
                        <span
                          className={
                            item.speaker === "agent"
                              ? "font-semibold text-accent-foreground"
                              : "font-semibold text-foreground"
                          }
                        >
                          {speaker}:
                        </span>{" "}
                        {item.text}
                      </p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">No transcript yet.</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

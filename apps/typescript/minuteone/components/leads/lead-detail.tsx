import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CancelButton } from "./cancel-button";
import { statusVariant, outcomeVariant } from "./badge-variants";
import type { LeadRow } from "@/lib/db/schema";

interface LeadDetailProps {
  lead: LeadRow;
  /** Where "back" links to — e.g. "/review" or "/dashboard/leads". */
  backHref: string;
  backLabel: string;
  questionPrompt: (questionId: string) => string;
}

/** The full lead detail view — intake fields plus the scored LeadCard once dispatch completes. */
export function LeadDetail({ lead, backHref, backLabel, questionPrompt }: LeadDetailProps) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={backHref} className="text-sm text-primary underline underline-offset-2">
        ← {backLabel}
      </Link>

      <div className="mt-4 mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(lead.status)}>{lead.status}</Badge>
          {lead.status === "pending" && <CancelButton leadId={lead.id} />}
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Intake</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Phone" value={lead.phone} />
          <Row label="Email" value={lead.email ?? "—"} />
          <Row label="Source" value={lead.source} />
          <Row label="Notes" value={lead.notes ?? "—"} />
          <Row label="Consent" value={lead.consent ? "Yes" : "No"} />
          <Row label="Submitted" value={lead.createdAt.toLocaleString()} />
        </CardContent>
      </Card>

      {lead.status === "done" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LeadCard</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Row
              label="Outcome"
              value={<Badge variant={outcomeVariant(lead.outcome ?? "")}>{lead.outcome}</Badge>}
            />
            <Row label="Score" value={`${lead.score ?? 0} / 100`} />
            <Row label="Next action" value={lead.nextAction ?? "—"} />
            <Row label="Summary" value={lead.summary ?? "—"} />
            <Row label="Call ID" value={lead.callId ?? "—"} />
            <Row label="Duration" value={lead.durationS != null ? `${lead.durationS}s` : "—"} />

            {lead.answers && lead.answers.length > 0 && (
              <>
                <Separator className="my-2" />
                <p className="font-medium">Answers</p>
                <div className="grid gap-2">
                  {lead.answers.map((a) => (
                    <div key={a.questionId}>
                      <p className="text-muted-foreground">{questionPrompt(a.questionId)}</p>
                      <p>{a.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          {lead.status === "pending" &&
            "Waiting for the worker to dispatch this lead (business hours + retry policy apply)."}
          {lead.status === "in_progress" && "Call in progress…"}
          {lead.status === "failed" && (lead.summary ?? "Dispatch failed.")}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{value}</span>
    </div>
  );
}

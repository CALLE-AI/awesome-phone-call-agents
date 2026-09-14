"use client";

import Link from "next/link";

import { ProvenanceChip, EstimateToConfirmed } from "@/app/_components/Provenance";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, X } from "lucide-react";

import { CheckForUpdates } from "@/components/calle/CheckForUpdates";
import LiveCallCard from "@/app/_components/LiveCallCard";
import BatchCallPanel from "@/app/_components/BatchCallPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { CampaignContextInput, CallTargetInput } from "@/app/_components/LiveCallCard";

/**
 * Calling from a launched campaign.
 *
 * Once a campaign existed there was no path back to calling at all - the
 * wizard's phone panel is on the review step, which is gone by then. This is
 * the natural home for it: the campaign is here, the lines are here, and
 * everything buildTask wants - advertiser, market, budget, real flight dates -
 * is on the page, so these calls carry the best task in the app.
 *
 * The row button opens the call card in place rather than dialling on one
 * click. Stations carry no phone number of their own and production has no
 * env fallback, so a number has to be typed - and the card already handles
 * that, plus every call state, the dial indicator and the failure copy.
 */

export interface PlanLine {
  id: string;
  name: string;
  /** Catalogue id, forwarded so the server can find a number for this line. */
  externalId?: string;
  kind: "STATION" | "CREATOR";
  channel: string | null;
  city: string | null;
  estCostPkr?: number | null;
  estReach: number | null;
  confirmedRatePkr?: number | null;
  bookedTotalPkr?: number | null;
  spots?: number | null;
  bookedAt?: Date | null;
  calls?: {
    mock: boolean;
    outcome: string | null;
    rateConfirmed?: boolean | null;
    confidenceLabel?: string | null;
    evidence?: string[];
    calleCallId?: string | null;
    transcript?: unknown;
  }[];
  status: string;
}

/** Mirrors CampaignDetail's map so a line reads the same in both places. */
const ITEM_STATUS: Record<string, { variant: "lilac" | "butter" | "muted" | "outline"; label: string }> = {
  SELECTED:  { variant: "muted",   label: "On plan" },
  CALLING:   { variant: "butter",  label: "Calling" },
  CONFIRMED: { variant: "lilac",   label: "Quoted" },
  DECLINED:  { variant: "outline", label: "Declined" },
  BOOKED:    { variant: "lilac",   label: "Booked" },
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

/** Just the button. The card it opens is rendered as a full-width row beneath
 *  the line, not inside a table cell - a 340px card in a narrow column
 *  overflows the table and buries the number field. */
export function CallLineButton({
  line,
  open,
  onToggle,
}: {
  line: PlanLine;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button variant={open ? "default" : "outline"} size="sm" onClick={onToggle}>
      <Phone aria-hidden strokeWidth={1.75} />
      {open
        ? "Close"
        : line.status === "CONFIRMED" || line.status === "DECLINED"
          ? "Call again"
          : "Call"}
    </Button>
  );
}

/** The call card for one line, shown across the full width of the table. */
export function LineCallPanel({
  campaignId,
  line,
  context,
  onClose,
}: {
  campaignId: string;
  line: PlanLine;
  context: CampaignContextInput;
  onClose: () => void;
}) {
  const target: CallTargetInput = {
    name: line.name,
    externalId: line.externalId,
    type: line.kind === "STATION" ? "station" : "creator",
    channel: line.channel ?? undefined,
    contactName: line.kind === "STATION" ? "the ad sales desk" : `${line.name} or their manager`,
    audienceSize: line.estReach ?? undefined,
    /* The line's own estimate. Without it buildMandate returns null and the
       call goes out with no mandate at all - so the one path that CAN produce
       the full chain was the one path that could not negotiate.
       a call went out this way with mandateTargetPkr
       null. It is the LINE's estimate, not the catalogue's: what this campaign
       was planned against, not what the contact says today. */
    estimatePkr: line.estCostPkr ?? undefined,
  };

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="type-label text-text-muted">Calling {line.name}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X aria-hidden strokeWidth={2} />
        </Button>
      </div>
      <div className="max-w-xl">
        <LiveCallCard
          target={target}
          context={context}
          campaignId={campaignId}
          mediaPlanItemId={line.id}
        />
      </div>
    </div>
  );
}

/**
 * The media plan table.
 *
 * A client component because one line at a time is "the one being called", and
 * the call card belongs in a full-width row beneath that line rather than
 * squeezed into its status cell - a 340px card in a narrow column overflows
 * the table and buries the number field. Same shape as the analytics table's
 * expanded rows.
 */
export function MediaPlanTable({
  campaignId,
  currency,
  items,
  context,
}: {
  campaignId: string;
  currency: string;
  items: PlanLine[];
  context: CampaignContextInput;
}) {
  /* One call surface at a time. A line id, the literal "batch", or nothing -
     so opening any call closes whatever else was open. Two panels on one
     screen, each with its own number field, was the confusion this replaces. */
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();
  const cur = currency;

  /* A line that is booked or already quoted is finished: the confirmed rate is
     the answer, and offering to call again beside it invites re-doing settled
     work. Those rows show the figure and no action. */
  const callable = items.filter(i => i.status !== "BOOKED" && i.status !== "CONFIRMED");

  return (
    <div className="flex flex-col gap-4">
      {/* The plan table is server-rendered from MediaPlanItem, so a sweep that
          settles a call is only visible after a refresh - hence onSettled. */}
      <CheckForUpdates onSettled={() => router.refresh()} />

      {callable.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant={open === "batch" ? "default" : "outline"}
            size="sm"
            onClick={() => setOpen(open === "batch" ? null : "batch")}
          >
            <Phone aria-hidden strokeWidth={1.75} />
            {open === "batch"
              ? "Close"
              : `Call ${callable.length} unconfirmed ${callable.length === 1 ? "line" : "lines"}`}
          </Button>
        </div>
      )}

    <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead className="text-right">Est. cost</TableHead>
                      <TableHead className="text-right">Audience</TableHead>
                      <TableHead className="text-right">Confirmed rate</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead><span className="sr-only">Call</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => {
                      const status = ITEM_STATUS[item.status] ?? ITEM_STATUS.SELECTED;
                      /* Did a real call produce this rate, or demo mode? A
                         simulated figure must never render as a confirmation
                         indistinguishable from a heard one. */
                      const confirmedBySim =
                        item.confirmedRatePkr != null &&
                        (item.calls ?? []).some(c => c.outcome === "RESULT" && c.mock);
                      /* The call that produced the confirmed figure - newest
                         first from the query, so the first RESULT is it. */
                      const resultCall = (item.calls ?? []).find(c => c.outcome === "RESULT");
                      return (
                        <Fragment key={item.id}>
                        <TableRow>
                          <TableCell>
                            <span className="flex flex-col gap-0.5">
                              <span className="max-w-52 truncate font-medium text-text">{item.name}</span>
                              <span className="type-label text-text-muted">
                                {item.kind === "STATION" ? "Station" : "Creator"}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="text-text-muted capitalize">{item.channel ?? "—"}</TableCell>
                          <TableCell className="text-text-muted">{item.city ?? "—"}</TableCell>
                          <TableCell className="type-data text-right text-text">
                            {item.estCostPkr == null ? "—" : `${cur} ${item.estCostPkr.toLocaleString()}`}
                          </TableCell>
                          <TableCell className="type-data text-right text-text">{fmt(item.estReach)}</TableCell>
                          {/* Empty until CALL-E has phoned this line. An
                              estimate is never copied into the confirmed
                              column to make the table look complete. */}
                          <TableCell className="text-right">
                            {item.confirmedRatePkr == null ? (
                              /* Nothing confirmed yet, so the estimate stands
                                 and says what it is. It used to render as a
                                 bare dash, which told you nothing about
                                 whether a number existed at all. */
                              <span className="flex flex-col items-end gap-1">
                                {item.estCostPkr == null ? (
                                  <span className="type-data text-text">—</span>
                                ) : (
                                  <>
                                    <span className="type-data text-text-muted">
                                      {cur} {item.estCostPkr.toLocaleString()}
                                    </span>
                                    <ProvenanceChip kind="estimate" />
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="flex flex-col items-end gap-1">
                                {/* The whole argument on one line: what we
                                    guessed, what they agreed to, and where it
                                    was said. Both stay - replacing the
                                    estimate would hide the only evidence that
                                    calling them was worth doing. */}
                                <EstimateToConfirmed
                                  estimatePkr={item.estCostPkr}
                                  confirmedPkr={item.confirmedRatePkr}
                                  currency={cur}
                                />
                                {confirmedBySim && <Badge variant="muted">Simulated</Badge>}
                                {/* A rate the recipient never confirmed looks
                                    identical to one they did. It says so, or
                                    the table is quietly claiming more than the
                                    call established. */}
                                {resultCall?.rateConfirmed === true ? (
                                  <ProvenanceChip kind="confirmed" />
                                ) : (
                                  <Badge variant="outline">
                                    {resultCall?.rateConfirmed === false
                                      ? "unconfirmed"
                                      : "confirmation unknown"}
                                  </Badge>
                                )}
                                {/* The last beat: a confirmed number opens the
                                    sentence that confirmed it. Only offered
                                    when a transcript was actually stored -
                                    a link that lands on an empty page is
                                    worse than no link. */}
                                {resultCall?.calleCallId &&
                                  Array.isArray(resultCall.transcript) &&
                                  resultCall.transcript.length > 0 && (
                                    <Link
                                      href={`/calls/${resultCall.calleCallId}#confirmation`}
                                      className="text-small text-lilac-deep underline underline-offset-2"
                                    >
                                      heard here
                                    </Link>
                                  )}
                              </span>
                            )}
                          </TableCell>
                          {/* Booked is the third column of the same story:
                              estimated, then quoted on a call, then committed
                              to. Nothing is copied across - a line that was
                              never booked stays an em dash. */}
                          <TableCell className="type-data text-right text-text">
                            {item.bookedTotalPkr == null
                              ? "—"
                              : `${cur} ${item.bookedTotalPkr.toLocaleString()}`}
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-col gap-1">
                              <Badge variant={status.variant}>{status.label}</Badge>
                              {item.spots != null && item.bookedAt != null && (
                                <span className="text-small text-text-muted">
                                  {item.spots} spot{item.spots === 1 ? "" : "s"}
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            {item.status === "BOOKED" || item.status === "CONFIRMED" ? null : (
                              <CallLineButton
                                line={item}
                                open={open === item.id}
                                onToggle={() => setOpen(open === item.id ? null : item.id)}
                              />
                            )}
                          </TableCell>
                        </TableRow>

                        {/* Full width, beneath the line it belongs to - the
                            card does not fit in a status cell. */}
                        {open === item.id && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-bone whitespace-normal">
                              <LineCallPanel
                                campaignId={campaignId}
                                line={item}
                                context={context}
                                onClose={() => setOpen(null)}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
    </Table>

      {/* Below the table, not above it: the batch panel used to expand between
          the header and the rows and shove the whole plan down the page. */}
      {open === "batch" && (
        <div className="flex flex-col gap-3 rounded-control bg-bone p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="type-label text-text-muted">Calling the plan</span>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(null)}>
              <X aria-hidden strokeWidth={2} />
            </Button>
          </div>
          <BatchCallPanel
            targets={callable.map(l => ({
              name: l.name,
              type: l.kind === "STATION" ? ("station" as const) : ("creator" as const),
              channel: l.channel ?? undefined,
              externalId: l.externalId,
              contactName: l.kind === "STATION" ? "the ad sales desk" : `${l.name} or their manager`,
              audienceSize: l.estReach ?? undefined,
              estimatePkr: l.estCostPkr ?? undefined,
            }))}
            context={context}
          />
        </div>
      )}
    </div>
  );
}

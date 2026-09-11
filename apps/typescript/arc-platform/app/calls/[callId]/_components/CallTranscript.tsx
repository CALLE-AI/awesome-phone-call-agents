"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ProvenanceChip, EstimateToConfirmed } from "@/app/_components/Provenance";
import { cn } from "@/lib/utils";
import { findConfirmation, plausibility, type Turn } from "@/lib/call-board";

/**
 * A transcript you can point at.
 *
 * Every confirmed figure on a plan links here with #confirmation, and the
 * anchor has to land on the exact exchange - not the top of a page of 120
 * turns with an instruction to go looking. The target turn is highlighted and
 * briefly flashed, because an anchor that scrolls silently leaves the viewer
 * hunting for what changed.
 */
export interface CallTranscriptData {
  calleCallId: string | null;
  targetName: string;
  targetType: "station" | "creator";
  status: string;
  outcome: string | null;
  pricePkr: number | null;
  rateBasis: string | null;
  rateConfirmed: boolean | null;
  estimateAtCallPkr: number | null;
  mandateTargetPkr: number | null;
  mandateWalkAwayPkr: number | null;
  completedAt: string | null;
  turns: Turn[];
}

const clock = (s: number | null | undefined) =>
  s == null ? "--:--" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function CallTranscript({ call }: { call: CallTranscriptData }) {
  const conf = findConfirmation(call.turns);
  const plaus = plausibility(call.pricePkr, call.estimateAtCallPkr);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (window.location.hash !== "#confirmation") return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-h1 text-text">{call.targetName}</h1>
        <p className="text-small text-text-muted">
          {call.status}
          {call.completedAt ? ` · ${new Date(call.completedAt).toLocaleString()}` : ""}
          {call.turns.length ? ` · ${call.turns.length} turns` : ""}
          {call.calleCallId ? ` · ${call.calleCallId}` : ""}
        </p>
      </header>

      {call.pricePkr != null && (
        <div className="flex flex-col gap-2 rounded-card bg-surface p-5 shadow-card">
          <span className="type-label text-text-muted">Rate heard on this call</span>
          {/* What we expected, and what they agreed to. */}
          <span className="flex flex-wrap items-baseline gap-2 text-h3">
            <EstimateToConfirmed
              estimatePkr={call.estimateAtCallPkr}
              confirmedPkr={call.pricePkr}
            />
            {call.rateBasis && <span className="text-small text-text-muted">{call.rateBasis}</span>}
          </span>
          <div className="flex flex-wrap gap-2">
            {call.rateConfirmed === true ? (
              <ProvenanceChip kind="confirmed" />
            ) : (
              <Badge variant="outline">
                {call.rateConfirmed === false ? "not confirmed" : "confirmation unknown"}
              </Badge>
            )}
            {plaus.kind === "out-of-range" && (
              <Badge variant="butter">
                outside the expected range — we estimated PKR {plaus.estimate.toLocaleString()}
              </Badge>
            )}
          </div>
        </div>
      )}

      {call.turns.length === 0 ? (
        <p className="rounded-card bg-surface p-5 text-small text-text-muted shadow-card">
          No transcript was stored for this call. Calls recorded before the
          transcript was kept with the record show nothing here — the
          conversation is not lost, it simply lives only at CALL-E.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5 rounded-card bg-surface p-5 shadow-card">
          {call.turns.map((t, i) => {
            const isConf = conf != null && (i === conf.askIndex || i === conf.yesIndex);
            return (
              <li
                key={i}
                id={conf && i === conf.askIndex ? "confirmation" : `turn-${i}`}
                className={cn(
                  "scroll-mt-28 rounded-sm px-2 py-1 text-small transition-colors",
                  isConf && "bg-butter",
                  isConf && flash && "ring-2 ring-butter-deep"
                )}
              >
                <span className="type-data text-text-muted">{clock(t.at)}</span>{" "}
                <span className={t.speaker === "bot" ? "text-lilac-deep" : "text-text-muted"}>
                  {t.speaker === "bot" ? "Arc" : "Them"}:
                </span>{" "}
                <span className="text-text">{t.text}</span>
                {conf && i === conf.askIndex && (
                  <span className="ml-2 inline-flex items-center gap-1 text-small text-success">
                    <Check aria-hidden strokeWidth={2} className="size-3" />
                    heard here
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

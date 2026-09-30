"use client";

import { Check, Phone, PhoneCall, PhoneOff, Loader2, Radio, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ProvenanceChip } from "@/app/_components/Provenance";
import { cn } from "@/lib/utils";
import { monogramInitials, monogramTone } from "@/lib/monogram";
import {
  phaseOf, phaseLabel, findConfirmation, fieldsSoFar, negotiationOf,
  type CallSnapshot, type BoardPhase,
} from "@/lib/call-board";

/**
 * One call, made legible while it happens.
 *
 * Only one call runs at a time, so this is not a grid that has to scale - it
 * is one card that has to be worth looking at. Everything it decides comes
 * from lib/call-board.ts, so the replay page and a live call render through
 * identical code.
 */

const PHASE_STYLE: Record<BoardPhase, { tone: string; Icon: typeof Phone; pulse: boolean }> = {
  dialling:           { tone: "bg-lilac",  Icon: Phone,     pulse: true },
  ringing:            { tone: "bg-lilac",  Icon: PhoneCall, pulse: true },
  "in conversation":  { tone: "bg-butter", Icon: PhoneCall, pulse: true },
  completed:          { tone: "bg-blush",  Icon: Check,     pulse: false },
  failed:             { tone: "bg-hairline", Icon: PhoneOff, pulse: false },
  /* Waiting is a state, not a fault. The queue has run well past an hour. */
  waiting:            { tone: "bg-hairline", Icon: Loader2, pulse: true },
};

export default function CallBoardCard({
  snapshot,
  /** How many turns to reveal. The replay page walks this up; a live call
   *  passes the whole transcript. */
  visibleTurns,
}: {
  snapshot: CallSnapshot;
  visibleTurns?: number;
}) {
  const turns = snapshot.turns.slice(0, visibleTurns ?? snapshot.turns.length);
  const shown: CallSnapshot = { ...snapshot, turns };

  const phase = phaseOf(shown);
  const style = PHASE_STYLE[phase];
  const fields = fieldsSoFar(shown);
  const conf = findConfirmation(turns);
  const neg = negotiationOf(shown);
  const live = phase === "in conversation" || phase === "ringing" || phase === "dialling";

  /* The last few turns, newest last - a ticker, not a transcript. The whole
     transcript appears below once the call is over. */
  const ticker = turns.slice(-6);

  return (
    <article className="flex flex-col gap-5 rounded-card bg-surface p-6 shadow-card">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-control font-display text-small font-medium text-ink",
            monogramTone(snapshot.id)
          )}>
            {monogramInitials(snapshot.targetName)}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-display text-h3 text-text">{snapshot.targetName}</h3>
            <span className="flex items-center gap-1.5 text-small text-text-muted">
              {snapshot.targetType === "station"
                ? <Radio aria-hidden strokeWidth={1.75} className="size-3.5" />
                : <Users aria-hidden strokeWidth={1.75} className="size-3.5" />}
              {snapshot.targetType}
            </span>
          </div>
        </div>

        {/* State, in words. Never "TIMEOUT" unless CALL-E said so. */}
        <span
          role="status"
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-pill px-3 py-1.5 text-small font-medium text-ink",
            style.tone
          )}
        >
          <style.Icon
            aria-hidden
            strokeWidth={1.75}
            className={cn("size-3.5", style.pulse && "animate-pulse")}
          />
          {phaseLabel(phase)}
        </span>
      </header>

      {phase === "waiting" && (
        <p className="rounded-control bg-bone px-4 py-3 text-small text-text-muted">
          CALL-E has not answered our last status check. The call is still
          running — this card keeps watching and fills in by itself.
        </p>
      )}

      {phase === "failed" && (
        <p className="rounded-control bg-bone px-4 py-3 text-small text-text-muted">
          The carrier did not put the call through
          {snapshot.failureCode ? ` (code ${snapshot.failureCode})` : ""}. Nothing was heard,
          so nothing is quoted below.
        </p>
      )}

      {/* ── fields, filling one at a time ── */}
      {fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5 rounded-control bg-bone px-3 py-2">
              <dt className="type-label text-text-muted">{f.label}</dt>
              <dd className="type-data text-text">{f.value}</dd>
              {f.key === "rate" && (
                <ProvenanceChip kind={f.confirmed ? "confirmed" : "estimate"} />
              )}
              {/* Confirmed is not the same as believed. The readback can work
                  perfectly and still produce a number that cannot be right -
                  1,253 per spot for a station we estimate at 8,000. */}
              {f.key === "rate" && f.plausibility?.kind === "out-of-range" && (
                <span className="text-small text-danger">
                  confirmed, but far outside the expected range for this{" "}
                  {snapshot.targetType} — we estimate PKR{" "}
                  {f.plausibility.estimate.toLocaleString()}. Needs review.
                </span>
              )}
              {f.key === "rate" && f.plausibility?.kind === "no-estimate" && (
                <span className="text-small text-text-muted">no estimate on file</span>
              )}
            </div>
          ))}
        </dl>
      )}

      {/* ── the confirmation moment ──
          The thing nothing else does. Given its own panel rather than left to
          be spotted in a scrolling transcript. */}
      {conf && (
        <div className="flex flex-col gap-2 rounded-control border border-success bg-bone p-4">
          <span className="flex items-center gap-2 type-label text-success">
            <Check aria-hidden strokeWidth={2} className="size-3.5" />
            Rate read back and confirmed
          </span>
          <p className="text-small text-text">
            <span className="text-text-muted">Arc:</span>{" "}
            &ldquo;{turns[conf.askIndex]?.text}&rdquo;
          </p>
          <p className="text-small text-text">
            <span className="text-text-muted">Them:</span>{" "}
            &ldquo;{turns[conf.yesIndex]?.text}&rdquo;
          </p>
        </div>
      )}

      {/* ── negotiation ── */}
      {neg && (
        <div className="flex flex-col gap-3 rounded-control border border-hairline p-4">
          <span className="type-label text-text-muted">How the price moved</span>
          <dl className="grid grid-cols-3 gap-3">
            {[
              { label: "Target", value: neg.target },
              { label: "Walk-away", value: neg.walkAway },
              { label: "Agreed", value: neg.agreed },
            ].map((x) => (
              <div key={x.label} className="flex flex-col gap-0.5">
                <dt className="type-label text-text-muted">{x.label}</dt>
                <dd className={cn(
                  "type-data",
                  x.label === "Agreed" && neg.walkAway && x.value && x.value > neg.walkAway
                    ? "text-danger" : "text-text"
                )}>
                  {x.value ? `PKR ${x.value.toLocaleString()}` : "—"}
                </dd>
              </div>
            ))}
          </dl>
          {neg.opening != null && (
            <p className="text-small text-text-muted">
              They opened at PKR {neg.opening.toLocaleString()}.
            </p>
          )}
          {neg.concessions.length > 0 && (
            <ol className="flex list-decimal flex-col gap-1.5 pl-4">
              {neg.concessions.map((c, i) => (
                <li key={`${c.offered}-${i}`} className="text-small text-text-muted">
                  Offered {c.offered}
                  {c.response ? ` — ${c.response}` : ""}
                  {c.rateAfter != null && (
                    <strong className="text-text"> → PKR {c.rateAfter.toLocaleString()}</strong>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── the ticker while live, the whole transcript once done ── */}
      {live && ticker.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-control bg-bone p-4" aria-live="polite">
          <span className="type-label text-text-muted">Live transcript</span>
          {ticker.map((t, i) => (
            <p key={`${t.at ?? i}-${i}`} className="text-small">
              <span className={t.speaker === "bot" ? "text-lilac-deep" : "text-text-muted"}>
                {t.speaker === "bot" ? "Arc" : "Them"}:
              </span>{" "}
              <span className="text-text">{t.text}</span>
            </p>
          ))}
        </div>
      )}

      {!live && turns.length > 0 && (
        <details className="rounded-control bg-bone p-4">
          <summary className="cursor-pointer type-label text-text-muted">
            Full transcript · {turns.length} turns
          </summary>
          <ol className="mt-3 flex flex-col gap-1.5">
            {turns.map((t, i) => (
              <li
                key={i}
                id={`turn-${snapshot.id}-${i}`}
                className={cn(
                  "scroll-mt-24 text-small",
                  conf && (i === conf.askIndex || i === conf.yesIndex) && "rounded-sm bg-butter px-2 py-1"
                )}
              >
                <span className="type-data text-text-muted">
                  {t.at != null ? `${String(Math.floor(t.at / 60)).padStart(2, "0")}:${String(t.at % 60).padStart(2, "0")}` : "--:--"}
                </span>{" "}
                <span className={t.speaker === "bot" ? "text-lilac-deep" : "text-text-muted"}>
                  {t.speaker === "bot" ? "Arc" : "Them"}:
                </span>{" "}
                <span className="text-text">{t.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* "heard here" - jumps to the turn a field came from. */}
      {!live && fields.some((f) => f.heardAt != null) && (
        <div className="flex flex-wrap gap-2">
          {fields.filter((f) => f.heardAt != null).map((f) => (
            <a
              key={f.key}
              href={`#turn-${snapshot.id}-${f.heardAt}`}
              className="text-small text-lilac-deep underline underline-offset-2"
            >
              {f.label} — heard here
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

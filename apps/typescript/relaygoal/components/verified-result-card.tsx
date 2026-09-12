"use client";

import type { VerifiedOutcome, VerifiedField } from "@/src/core/types";
import { VerificationChip } from "./verification-chip";
import { markValue } from "./evidence-quote";
import { findDisclosure } from "@/src/core/disclosure";

function fmtOffset(offset: number): string {
  const m = Math.floor(offset / 60);
  const sec = offset % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function humanize(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Header verdict: one quiet sentence, tone-tinted, with a solid state badge. The
// per-field pills carry the detail; the banner is the headline you read first.
function statusLine(outcome: VerifiedOutcome): { text: string; tone: "verified" | "caution" | "destructive"; icon: "check" | "warn" | "x" } {
  const total = outcome.fields.length;
  const ok = outcome.fields.filter((f) => f.status === "verified").length;
  if (outcome.unreachable) return { text: "Couldn't reach them. Nothing was confirmed.", tone: "destructive", icon: "x" };
  if (ok === total) return { text: `${ok} of ${total} answers verified from the call`, tone: "verified", icon: "check" };
  if (ok === 0) return { text: `None of the ${total} answers could be confirmed`, tone: "caution", icon: "warn" };
  return { text: `${ok} of ${total} answers verified, ${total - ok} not confirmed`, tone: "caution", icon: "warn" };
}

const TONE_TEXT: Record<"verified" | "caution" | "destructive", string> = {
  verified: "text-verified",
  caution: "text-caution-foreground",
  destructive: "text-destructive",
};
const TONE_BADGE: Record<"verified" | "caution" | "destructive", string> = {
  verified: "bg-verified text-verified-foreground",
  caution: "bg-caution text-caution-foreground",
  destructive: "bg-destructive text-destructive-foreground",
};
const TONE_BAND: Record<"verified" | "caution" | "destructive", string> = {
  verified: "bg-verified/10 dark:bg-verified/20 dark:ring-1 dark:ring-inset dark:ring-verified/40",
  caution: "bg-caution/15 dark:bg-caution/25 dark:ring-1 dark:ring-inset dark:ring-caution/40",
  destructive: "bg-destructive/10 dark:bg-destructive/25 dark:ring-1 dark:ring-inset dark:ring-destructive/40",
};

function StatusIcon({ icon, size = 18 }: { icon: "check" | "warn" | "x"; size?: number }) {
  if (icon === "check")
    return (
      <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" fill="currentColor">
        <path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" />
      </svg>
    );
  if (icon === "warn")
    return (
      <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" fill="currentColor">
        <path d="M10 2 1 18h18L10 2zm0 5 .9 6h-1.8L10 7zm0 8.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="m10 8.6 3.5-3.5 1.4 1.4L11.4 10l3.5 3.5-1.4 1.4L10 11.4l-3.5 3.5-1.4-1.4L8.6 10 5.1 6.5l1.4-1.4z" />
    </svg>
  );
}

export function VerifiedResultCard({
  outcome,
  phoneMasked,
  presetLabel,
  onCiteQuote,
}: {
  outcome: VerifiedOutcome;
  phoneMasked: string;
  presetLabel: string;
  onCiteQuote: (offsetSeconds: number) => void;
}) {
  const status = statusLine(outcome);
  const disclosure = findDisclosure(outcome.transcript);
  const unconfirmed = outcome.fields.filter((f) => f.status !== "verified").map((f) => humanize(f.key));

  const turns = outcome.transcript.length;
  const lastOffset = turns > 0 ? outcome.transcript[turns - 1]!.offsetSeconds : 0;

  // Track which transcript sentences have already been shown so a sentence that
  // proves two answers is quoted once in full and referenced the second time.
  const shown = new Map<number, string>();

  return (
    <section aria-labelledby="result-heading" className="receipt overflow-hidden">
      {/* Header band — the receipt masthead: what this is, and the call record. */}
      <header className="bg-receipt-head px-5 py-4 text-receipt-head-foreground">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-receipt-head-foreground/75">Proof of call</p>
        <h2 id="result-heading" className="mt-1 text-2xl text-receipt-head-foreground">{presetLabel}</h2>
        {turns > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-receipt-head-foreground/80">
            {phoneMasked && (
              <>
                <span>{phoneMasked}</span>
                <span aria-hidden="true" className="opacity-50">·</span>
              </>
            )}
            <span>{turns} exchanges</span>
            <span aria-hidden="true" className="opacity-50">·</span>
            <span>{fmtOffset(lastOffset)} on the call</span>
          </p>
        )}
      </header>

      {/* Verdict banner — the headline you read first. */}
      <div className={`flex items-center gap-3 border-b border-border px-5 py-3.5 ${TONE_BAND[status.tone]}`}>
        <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${TONE_BADGE[status.tone]}`}>
          <StatusIcon icon={status.icon} size={16} />
        </span>
        <p className={`text-lg font-semibold leading-tight ${TONE_TEXT[status.tone]}`}>{status.text}</p>
      </div>

      {/* Disclosure — an audit stamp, because "did the AI say it was an AI?" is a trust question. */}
      {outcome.transcript.length > 0 && (
        <div className="border-b border-border px-5 py-3">
          {disclosure.disclosed && disclosure.turn ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="stamp inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[0.7rem] font-semibold uppercase tracking-wider text-verified">
                <StatusIcon icon="check" size={12} />
                AI disclosed · {fmtOffset(disclosure.turn.offsetSeconds)}
              </span>
              <span className="italic">&ldquo;{disclosure.turn.text}&rdquo;</span>
              <button
                type="button"
                onClick={() => onCiteQuote(disclosure.turn!.offsetSeconds)}
                className="rounded-md px-1.5 py-0.5 font-semibold text-primary underline underline-offset-2 hover:bg-accent"
              >
                Show in transcript
              </button>
            </div>
          ) : (
            <p className="text-sm">
              <span className="stamp inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[0.7rem] font-semibold uppercase tracking-wider text-caution-foreground">
                <StatusIcon icon="warn" size={12} />
                No AI disclosure
              </span>{" "}
              <span className="text-muted-foreground">found in the agent&apos;s words on this call.</span>
            </p>
          )}
        </div>
      )}

      {outcome.summary && (
        <p className="border-b border-border px-5 py-3 text-muted-foreground">{outcome.summary}</p>
      )}

      <dl className="divide-y divide-border">
        {outcome.fields.map((field) => {
          const priorLabel = field.quotes[0] ? shown.get(field.quotes[0].offsetSeconds) : undefined;
          if (field.status === "verified" && field.quotes[0] && !priorLabel) {
            shown.set(field.quotes[0].offsetSeconds, humanize(field.key));
          }
          return (
            <FieldRow key={field.key} field={field} onCiteQuote={onCiteQuote} sameSentenceAs={priorLabel} />
          );
        })}
      </dl>

      {outcome.overall !== "verified" && (
        <div role="note" className="m-5 rounded-lg border-l-4 border-caution bg-caution/10 p-4">
          <p className="font-semibold text-foreground">
            {outcome.unreachable
              ? "Nothing was confirmed. Please try again later or call yourself."
              : `${unconfirmed.join(" and ")} could not be confirmed. Call them yourself to be sure.`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Number to call: <span className="font-mono text-foreground">{phoneMasked}</span>
          </p>
        </div>
      )}

      <div className="receipt-perf" aria-hidden="true" />
    </section>
  );
}

function FieldRow({
  field,
  onCiteQuote,
  sameSentenceAs,
}: {
  field: VerifiedField;
  onCiteQuote: (offsetSeconds: number) => void;
  sameSentenceAs?: string;
}) {
  const raw = field.value === null || field.value === undefined || field.value === "" ? "No answer" : String(field.value);
  const value = raw.charAt(0).toUpperCase() + raw.slice(1);
  const quote = field.quotes[0];

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <dt className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{humanize(field.key)}</dt>
        <VerificationChip status={field.status === "verified" ? "verified" : "unverified"} />
      </div>
      <dd className="num-clean mt-1 text-2xl font-semibold leading-tight text-foreground">{value}</dd>

      {field.status === "verified" && quote && !sameSentenceAs && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-ledger">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="text-verified" aria-hidden="true"><StatusIcon icon="check" size={13} /></span>
            <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              They said · {fmtOffset(quote.offsetSeconds)}
            </span>
          </div>
          <blockquote className="px-3 pb-1 pt-2 italic leading-snug">&ldquo;{markValue(quote.text, value)}&rdquo;</blockquote>
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => onCiteQuote(quote.offsetSeconds)}
              className="rounded-md py-1 pr-1 text-sm font-semibold text-primary underline underline-offset-2 hover:bg-accent"
            >
              Show in transcript &rarr;
            </button>
          </div>
        </div>
      )}

      {field.status === "verified" && quote && sameSentenceAs && (
        <p className="mt-2 text-sm text-muted-foreground">
          Same sentence as <span className="font-semibold text-foreground">{sameSentenceAs}</span>:{" "}
          <span className="italic">&ldquo;{markValue(quote.text, value)}&rdquo;</span>{" "}
          <button
            type="button"
            onClick={() => onCiteQuote(quote.offsetSeconds)}
            className="rounded-md px-1.5 py-0.5 font-semibold text-primary underline underline-offset-2 hover:bg-accent"
          >
            Show in transcript
          </button>
        </p>
      )}

      {field.status === "unverified" && field.reason && (
        <p className="mt-2 text-sm text-muted-foreground">{field.reason.charAt(0).toUpperCase() + field.reason.slice(1)}.</p>
      )}
    </div>
  );
}

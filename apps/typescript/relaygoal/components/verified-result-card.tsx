"use client";

import type { VerifiedOutcome, VerifiedField } from "@/src/core/types";
import { VerificationChip } from "./verification-chip";
import { EvidenceQuote, markValue } from "./evidence-quote";
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

// Header status line: one quiet sentence in a fixed slot, never a pill. The pills
// belong to the per-field rows; repeating one at the top turned proof into wallpaper.
function statusLine(outcome: VerifiedOutcome): { text: string; tone: "verified" | "caution" | "destructive"; icon: "check" | "warn" | "x" } {
  const total = outcome.fields.length;
  const ok = outcome.fields.filter((f) => f.status === "verified").length;
  if (outcome.unreachable) return { text: "Couldn't reach them. Nothing was confirmed.", tone: "destructive", icon: "x" };
  if (ok === total) return { text: `${ok} of ${total} answers verified from the call`, tone: "verified", icon: "check" };
  if (ok === 0) return { text: `None of the ${total} answers could be confirmed`, tone: "caution", icon: "warn" };
  return { text: `${ok} of ${total} answers verified, ${total - ok} not confirmed`, tone: "caution", icon: "warn" };
}

const TONE: Record<"verified" | "caution" | "destructive", string> = {
  verified: "text-verified",
  caution: "text-caution-foreground",
  destructive: "text-destructive",
};

function StatusIcon({ icon }: { icon: "check" | "warn" | "x" }) {
  if (icon === "check")
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
        <path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" />
      </svg>
    );
  if (icon === "warn")
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
        <path d="M10 2 1 18h18L10 2zm0 5 .9 6h-1.8L10 7zm0 8.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
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

  // Track which transcript sentences have already been shown so a sentence that
  // proves two answers is quoted once in full and referenced the second time.
  const shown = new Map<number, string>();

  return (
    <section
      aria-labelledby="result-heading"
      className="rounded-xl border border-border bg-card text-card-foreground shadow-sm"
    >
      <header className="border-b border-border p-5">
        <p className="text-sm font-medium text-muted-foreground">Result</p>
        <h2 id="result-heading" className="text-2xl">{presetLabel}</h2>
        <p className={`mt-2 flex items-start gap-1.5 font-semibold ${TONE[status.tone]}`}>
          <span className="mt-1 flex-none"><StatusIcon icon={status.icon} /></span>
          <span>{status.text}</span>
        </p>
      </header>

      {outcome.summary && (
        <p className="border-b border-border px-5 py-3 text-muted-foreground">{outcome.summary}</p>
      )}

      {outcome.transcript.length > 0 && (
        <p className="border-b border-border px-5 py-3 text-sm text-muted-foreground">
          {disclosure.disclosed && disclosure.turn ? (
            <>
              <span className="font-semibold text-foreground">AI disclosed</span> at{" "}
              <span className="font-mono">{fmtOffset(disclosure.turn.offsetSeconds)}</span>: &ldquo;{disclosure.turn.text}&rdquo;{" "}
              <button
                type="button"
                onClick={() => onCiteQuote(disclosure.turn!.offsetSeconds)}
                className="rounded-md px-1.5 py-0.5 font-semibold text-primary underline underline-offset-2 hover:bg-accent"
              >
                Show in transcript
              </button>
            </>
          ) : (
            <>
              <span className="font-semibold text-caution-foreground">No AI disclosure found</span> in the agent&apos;s
              words on this call.
            </>
          )}
        </p>
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
        <div role="note" className="m-5 rounded-lg border-l-4 border-caution bg-muted/50 p-4">
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
  const value = field.value === null || field.value === undefined || field.value === ""
    ? "No answer"
    : String(field.value);
  const quote = field.quotes[0];

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{humanize(field.key)}</dt>
        <VerificationChip status={field.status === "verified" ? "verified" : "unverified"} />
      </div>
      <dd className="mt-0.5 text-2xl font-medium leading-tight text-foreground">{value}</dd>

      {field.status === "verified" && quote && !sameSentenceAs && (
        <EvidenceQuote text={quote.text} value={value} onCite={() => onCiteQuote(quote.offsetSeconds)} />
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

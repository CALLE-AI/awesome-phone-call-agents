"use client";

import type { BatchOutcome, BatchItemResult } from "@/src/core/batch";
import { VerificationChip } from "./verification-chip";
import { EvidenceQuote } from "./evidence-quote";

/** Present raw extracted tokens ("yes", "unknown") as sentence-case statements. */
function sentence(v: string): string {
  return v.length > 0 ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

function humanize(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function BatchResultCard({
  outcome,
  presetLabel,
}: {
  outcome: BatchOutcome;
  presetLabel: string;
}) {
  // Best pick first, then the rest in their original order.
  const ordered = [...outcome.items].sort((a, b) => {
    if (a.recipient.id === outcome.bestId) return -1;
    if (b.recipient.id === outcome.bestId) return 1;
    return 0;
  });
  const best = outcome.items.find((i) => i.recipient.id === outcome.bestId);

  return (
    <section aria-labelledby="batch-heading" className="flex flex-col gap-4">
      {/* Comparison receipt: same masthead + verdict language as the single-call proof. */}
      <div className="receipt overflow-hidden">
        <header className="bg-receipt-head px-5 py-4 text-receipt-head-foreground">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-receipt-head-foreground/75">Proof of call · Comparison</p>
          <h2 id="batch-heading" className="mt-1 text-2xl text-receipt-head-foreground">{presetLabel}</h2>
          <p className="mt-2.5 font-mono text-xs text-receipt-head-foreground/80">{outcome.items.length} places called</p>
        </header>

        {best ? (
          <div className="flex items-center gap-3 border-b border-border bg-verified/10 px-5 py-3.5 dark:bg-verified/20">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-verified text-verified-foreground">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" /></svg>
            </span>
            <p className="text-lg font-semibold leading-tight text-verified">Best pick: {best.recipient.label}</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 border-b border-border bg-caution/15 px-5 py-3.5 dark:bg-caution/25">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-caution text-caution-foreground">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M10 2 1 18h18L10 2zm0 5 .9 6h-1.8L10 7zm0 8.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" /></svg>
            </span>
            <p className="text-lg font-semibold leading-tight text-caution-foreground">No confirmed winner</p>
          </div>
        )}

        <div className="px-5 py-3.5">
          <p className="text-muted-foreground">{outcome.reason}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono text-xs uppercase tracking-wider">Ranked by</span> {outcome.rankedBy}
          </p>
        </div>
        <div className="receipt-perf" aria-hidden="true" />
      </div>

      <ol className="flex flex-col gap-4">
        {ordered.map((item) => (
          <PlaceCard key={item.recipient.id} item={item} isBest={item.recipient.id === outcome.bestId} rankKey={outcome.rankKey} />
        ))}
      </ol>
    </section>
  );
}

// Each place is a mini call-record. The winner is elevated (receipt material + a
// teal ribbon); the rest are plain cards. Per-field pills carry the status.
function PlaceCard({ item, isBest, rankKey }: { item: BatchItemResult; isBest: boolean; rankKey?: string }) {
  const rankField = rankKey ? item.outcome.fields.find((f) => f.key === rankKey) : undefined;
  const rankValue = rankField && rankField.value !== null && rankField.value !== "" ? String(rankField.value) : null;
  return (
    <li className={isBest ? "receipt overflow-hidden" : "overflow-hidden rounded-xl border border-border bg-card"}>
      {isBest && (
        <p className="bg-receipt-head px-4 py-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-receipt-head-foreground">
          ★ Best pick
        </p>
      )}
      <div className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg">{item.recipient.label}</h3>
          <div className="flex items-baseline gap-3">
            {rankValue && (
              <span className={`num-clean text-xl font-semibold ${rankField?.status === "verified" ? "text-foreground" : "text-muted-foreground"}`} title={rankField?.status === "verified" ? "verified on the call" : "not confirmed on the call"}>
                {sentence(rankValue)}
                {rankField?.status !== "verified" && <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-caution-foreground">unconfirmed</span>}
              </span>
            )}
            <span className="font-mono text-sm text-muted-foreground">{item.recipient.phone}</span>
          </div>
        </div>
        {item.outcome.unreachable && (
          <p className="mt-2 text-sm">
            <VerificationChip status="unreachable" />
          </p>
        )}
        <dl className="mt-3 divide-y divide-border">
          {item.outcome.fields.map((field) => {
            const value = field.value === null || field.value === "" ? "No answer" : sentence(String(field.value));
            return (
              <div key={field.key} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{humanize(field.key)}</dt>
                  <VerificationChip status={field.status === "verified" ? "verified" : "unverified"} />
                </div>
                <dd className="num-clean mt-0.5 text-xl font-semibold leading-tight text-foreground">{value}</dd>
                {field.status === "verified" && field.quotes[0] && (
                  <EvidenceQuote text={field.quotes[0].text} value={value} offsetSeconds={field.quotes[0].offsetSeconds} size="sm" />
                )}
                {field.status === "unverified" && field.reason && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {field.reason.charAt(0).toUpperCase() + field.reason.slice(1)}.
                  </p>
                )}
              </div>
            );
          })}
        </dl>
        {item.outcome.transcript.length > 0 && (
          <details className="mt-3 rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-primary">
              Full transcript ({item.outcome.transcript.length} turns)
            </summary>
            <ol className="flex flex-col gap-2 border-t border-border p-3 text-sm" aria-label={`Transcript for ${item.recipient.label}`}>
              {item.outcome.transcript.map((t) => (
                <li key={t.offsetSeconds} className={t.speaker === "bot" ? "text-muted-foreground" : "text-foreground"}>
                  <span className="font-semibold">{t.speaker === "bot" ? "Agent" : "Them"}</span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">{Math.floor(t.offsetSeconds / 60)}:{String(t.offsetSeconds % 60).padStart(2, "0")}</span>{" "}
                  {t.text}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </li>
  );
}

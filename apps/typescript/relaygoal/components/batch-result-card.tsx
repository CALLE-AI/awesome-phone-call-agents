"use client";

import type { BatchOutcome, BatchItemResult } from "@/src/core/batch";
import { VerificationChip } from "./verification-chip";
import { EvidenceQuote } from "./evidence-quote";

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
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-medium text-muted-foreground">Compared {outcome.items.length} places</p>
        <h2 id="batch-heading" className="text-2xl">{presetLabel}</h2>
        {best ? (
          <p className="mt-2 flex items-center gap-1.5 font-semibold text-verified">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
              <path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" />
            </svg>
            <span>Best pick: {best.recipient.label}</span>
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 font-semibold text-caution-foreground">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
              <path d="M10 2 1 18h18L10 2zm0 5 .9 6h-1.8L10 7zm0 8.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" />
            </svg>
            <span>No confirmed winner</span>
          </p>
        )}
        <p className="mt-2 text-muted-foreground">{outcome.reason}</p>
        <p className="mt-1 text-sm text-muted-foreground">Ranked by: {outcome.rankedBy}</p>
      </div>

      <ol className="flex flex-col gap-4">
        {ordered.map((item) => (
          <PlaceCard key={item.recipient.id} item={item} isBest={item.recipient.id === outcome.bestId} />
        ))}
      </ol>
    </section>
  );
}

// The winner is marked by its border alone; the per-field pills carry the status.
function PlaceCard({ item, isBest }: { item: BatchItemResult; isBest: boolean }) {
  return (
    <li
      className={`rounded-xl border bg-card p-4 ${isBest ? "border-verified ring-1 ring-verified" : "border-border"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg">
          {item.recipient.label}
          {isBest && <span className="ml-2 text-sm font-semibold text-verified">Best pick</span>}
        </h3>
        <span className="font-mono text-sm text-muted-foreground">{item.recipient.phone}</span>
      </div>
      {item.outcome.unreachable && (
        <p className="mt-2 text-sm">
          <VerificationChip status="unreachable" />
        </p>
      )}
      <dl className="mt-3 divide-y divide-border">
        {item.outcome.fields.map((field) => {
          const value = field.value === null || field.value === "" ? "No answer" : String(field.value);
          return (
            <div key={field.key} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="font-semibold">{humanize(field.key)}</dt>
                <VerificationChip status={field.status === "verified" ? "verified" : "unverified"} />
              </div>
              <dd className="mt-0.5">{value}</dd>
              {field.status === "verified" && field.quotes[0] && (
                <EvidenceQuote text={field.quotes[0].text} value={value} size="sm" />
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
    </li>
  );
}

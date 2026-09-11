"use client";

// The one evidence component, used by the comparison cards so "answer bound to the
// exact words" is one shape everywhere. Renders as a ledger line-item: a mono
// "they said · offset" stamp over the sentence that proves the answer, with the
// answer marked inside it. (The single-call receipt inlines the same shape.)
export function markValue(quote: string, value: string): React.ReactNode {
  const needle = value.trim();
  if (needle.length < 2) return quote;
  const idx = quote.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return quote;
  return (
    <>
      {quote.slice(0, idx)}
      <mark className="rounded-sm bg-verified/25 px-0.5 not-italic font-semibold text-foreground">
        {quote.slice(idx, idx + needle.length)}
      </mark>
      {quote.slice(idx + needle.length)}
    </>
  );
}

function fmtOffset(offset: number): string {
  const m = Math.floor(offset / 60);
  const s = offset % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EvidenceQuote({
  text,
  value,
  onCite,
  offsetSeconds,
  size = "md",
}: {
  text: string;
  value: string;
  onCite?: () => void;
  offsetSeconds?: number;
  size?: "md" | "sm";
}) {
  const small = size === "sm";
  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-ledger">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <span className="text-verified" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" /></svg>
        </span>
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          They said{offsetSeconds !== undefined ? ` · ${fmtOffset(offsetSeconds)}` : ""}
        </span>
      </div>
      <blockquote className={`px-3 pb-2 pt-2 italic leading-snug ${small ? "text-sm" : ""}`}>
        &ldquo;{markValue(text, value)}&rdquo;
      </blockquote>
      {onCite && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={onCite}
            className="rounded-md py-1 text-sm font-semibold text-primary underline underline-offset-2 hover:bg-accent"
          >
            Show in transcript &rarr;
          </button>
        </div>
      )}
    </div>
  );
}

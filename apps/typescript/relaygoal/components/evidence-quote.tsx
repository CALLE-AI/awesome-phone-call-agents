"use client";

// The one evidence component, used by both the single-call card and the comparison
// cards so "answer bound to the exact words" is one shape everywhere. Marks the
// answer inside the sentence that proves it.
export function markValue(quote: string, value: string): React.ReactNode {
  const needle = value.trim();
  if (needle.length < 2) return quote;
  const idx = quote.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return quote;
  return (
    <>
      {quote.slice(0, idx)}
      <mark className="rounded-sm bg-verified/20 px-0.5 not-italic font-semibold text-foreground">
        {quote.slice(idx, idx + needle.length)}
      </mark>
      {quote.slice(idx + needle.length)}
    </>
  );
}

export function EvidenceQuote({
  text,
  value,
  onCite,
  size = "md",
}: {
  text: string;
  value: string;
  onCite?: () => void;
  size?: "md" | "sm";
}) {
  const small = size === "sm";
  return (
    <div className={`rounded-lg border-l-4 border-verified bg-muted/50 ${small ? "mt-2 px-3 py-2" : "mt-3 p-3"}`}>
      <p className={`font-medium text-muted-foreground ${small ? "text-xs" : "mb-1 text-sm"}`}>They said:</p>
      <blockquote className={`italic ${small ? "text-sm" : ""}`}>&ldquo;{markValue(text, value)}&rdquo;</blockquote>
      {onCite && (
        <button
          type="button"
          onClick={onCite}
          className="mt-2 rounded-md px-2 py-1 text-sm font-semibold text-primary underline underline-offset-2 hover:bg-accent"
        >
          Show in transcript
        </button>
      )}
    </div>
  );
}

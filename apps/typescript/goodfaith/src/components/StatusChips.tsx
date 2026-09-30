// File: src/components/StatusChips.tsx
import type { NormalizedResult } from "@/lib/normalize";

const META: Record<string, { label: string; cls: string; dot: string }> = {
  ranked: { label: "quoted", cls: "border border-good/40 bg-good/15 text-good-soft", dot: "bg-good" },
  non_comparable: { label: "flagged", cls: "border border-warn/40 bg-warn/15 text-warn-soft", dot: "bg-warn" },
  needs_review: { label: "needs review", cls: "border border-warn/40 bg-warn/15 text-warn-soft", dot: "bg-warn" },
  no_quote: { label: "no quote", cls: "border border-ink-600 bg-ink-800 text-paper-400", dot: "bg-paper-500" },
};

export function StatusChips({ results }: { results: NormalizedResult[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {results.map((r, i) => {
        const m = META[r.status] ?? META.no_quote;
        return (
          <li key={i} className={`badge ${m.cls}`}>
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
            <span className="text-paper-200">{r.name}</span>
            <span className="opacity-70">· {m.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

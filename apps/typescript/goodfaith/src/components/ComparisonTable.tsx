// File: src/components/ComparisonTable.tsx
import type { NormalizedResult, Benchmark } from "@/lib/normalize";
import { AuditTrail } from "@/components/AuditTrail";

function pct(n: number | null) {
  if (n === null) return "";
  return n <= 0 ? `${Math.abs(n)}% below fair` : `${n}% above fair`;
}

function money(n: number | null) {
  if (n === null) return "n/a";
  return `$${n.toLocaleString("en-US")}`;
}

// The "looks cheapest" trap: a facility-only row that quotes a bare number a naive ranker
// would treat as a comparable price. Surfacing the contrast explicitly is the wow moment (E-3).
// It's a decoy not because its number is lower, but because a single facility leg hides the
// professional read — the sticker looks like "the price" when it isn't a complete one.
function findDecoy(nonComparable: NormalizedResult[]): NormalizedResult | undefined {
  return nonComparable
    .filter((r) => r.price_basis === "facility_only" && typeof r.landed_cost === "number")
    .sort((a, b) => (a.landed_cost as number) - (b.landed_cost as number))[0];
}

export function ComparisonTable({
  results,
  benchmark,
  mode,
}: {
  results: NormalizedResult[];
  benchmark: Benchmark;
  mode: "mock" | "live";
}) {
  const ranked = results.filter((r) => r.ranked);
  const nonComparable = results.filter((r) => r.status === "non_comparable" || r.status === "needs_review");
  const noQuote = results.filter((r) => r.status === "no_quote");
  const winner = ranked[0];
  const decoy = findDecoy(nonComparable);

  return (
    <div className="space-y-12">
      {/* E-3 WINNER FLIP — the centerpiece. "Looks cheapest ✗" struck vs "Real winner ✓". */}
      {winner && decoy && (
        <section aria-labelledby="flip-heading" className="animate-fade-in">
          <div className="mb-4 flex items-center gap-3">
            <h2 id="flip-heading" className="font-serif text-2xl">
              The cheapest sticker isn&apos;t the cheapest price
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
            {/* Decoy — looks cheapest, but flagged */}
            <div className="card relative overflow-hidden border-bad/40 p-6">
              <span className="badge border border-bad/40 bg-bad/15 text-bad-soft">Looks cheapest ✗</span>
              <div className="mt-4 font-serif text-5xl tnum text-paper-500 line-through decoration-bad/60 decoration-2">
                {money(decoy.landed_cost)}
              </div>
              <p className="mt-2 text-base text-paper-200">{decoy.name}</p>
              <p className="mt-3 text-sm leading-relaxed text-bad-soft">
                Facility fee only. The radiologist read is billed separately, so this sticker is <em>not</em> the price
                you&apos;d actually pay, and a naive &ldquo;cheapest number&rdquo; ranker would fall for it.
              </p>
              <p className="mt-3 text-xs text-paper-500">
                Flagged <span className="font-mono text-paper-400">{decoy.rejection}</span>, so it is excluded from the ranking.
              </p>
            </div>

            {/* Connective flip glyph */}
            <div
              aria-hidden
              className="hidden items-center justify-center text-2xl font-light text-paper-500 md:flex"
            >
              →
            </div>

            {/* Real winner */}
            <div className="card relative overflow-hidden border-2 border-accent p-6 shadow-winner">
              <span className="badge bg-accent text-ink-950">Real winner ✓</span>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="font-serif text-5xl tnum text-accent">{money(winner.landed_cost)}</span>
                <span className="text-sm font-medium text-good-soft">{pct(winner.pct_vs_fair)}</span>
              </div>
              <p className="mt-2 text-base text-paper-100">{winner.name}</p>
              <p className="mt-3 text-sm leading-relaxed text-good-soft">
                All-inclusive. One price covers the scan <em>and</em> the radiologist read. This is the true landed
                cost you&apos;d pay.
              </p>
              <div className="mt-4 border-t border-ink-700 pt-3">
                <AuditTrail row={winner} mode={mode} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Fallback single winner card when there is no decoy to contrast */}
      {winner && !decoy && (
        <div className="card animate-fade-in border-2 border-accent p-6 shadow-winner">
          <p className="mb-1 text-sm text-paper-400">Best comparable cash price</p>
          <div className="flex items-baseline gap-4">
            <span className="font-serif text-5xl tnum text-accent">{money(winner.landed_cost)}</span>
            <span className="text-good-soft">{pct(winner.pct_vs_fair)}</span>
          </div>
          <p className="mt-2 text-paper-100">{winner.name}</p>
          <p className="mt-1 text-sm text-paper-500">All-inclusive: the true landed cost.</p>
          <div className="mt-4 border-t border-ink-700 pt-3">
            <AuditTrail row={winner} mode={mode} />
          </div>
        </div>
      )}

      {/* Comparable, ranked bucket */}
      <section aria-labelledby="ranked-heading">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-good" aria-hidden />
          <h2 id="ranked-heading" className="font-serif text-xl">
            Comparable, ranked
          </h2>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-paper-400">
          Only all-inclusive cash prices with a traceable receipt are ranked head-to-head.
        </p>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-paper-500">
                <th scope="col" className="px-5 py-3 font-medium">
                  Clinic
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  You&apos;d pay
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  vs fair price
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Earliest
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={i} className={`border-t border-ink-800 ${i === 0 ? "bg-accent/[0.06]" : ""}`}>
                  <td className="px-5 py-3.5 text-paper-100">
                    {i === 0 && (
                      <span className="mr-1.5 text-accent" aria-label="best price">
                        ★
                      </span>
                    )}
                    {r.name}
                  </td>
                  <td className="px-3 py-3.5 font-medium tnum text-paper-100">{money(r.landed_cost)}</td>
                  <td className="px-3 py-3.5 tnum text-good-soft">{pct(r.pct_vs_fair)}</td>
                  <td className="px-3 py-3.5 tnum text-paper-300">
                    {r.earliest_appointment_days !== null ? `${r.earliest_appointment_days}d` : "n/a"}
                  </td>
                  <td className="px-3 py-3.5">
                    <AuditTrail row={r} mode={mode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-3 text-xs text-paper-500">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-paper-400 transition-colors hover:text-paper-200">
            How the benchmark works
          </summary>
          <p className="mt-2 max-w-2xl leading-relaxed">
            Fair self-pay {money(benchmark.fair_self_pay)} · national average {money(benchmark.national_average)} (
            {benchmark.label}). &ldquo;vs fair price&rdquo; = (landed cost − fair self-pay) / fair self-pay. A
            low-confidence call (score &lt; 0.6) is held back for review and never ranked.
          </p>
        </details>
      </section>

      {/* Non-comparable bucket */}
      {nonComparable.length > 0 && (
        <section aria-labelledby="flagged-heading">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />
            <h2 id="flagged-heading" className="font-serif text-xl">
              Not comparable
            </h2>
          </div>
          <p className="mb-4 max-w-2xl text-sm text-paper-400">
            These clinics gave a price, but not one you can fairly compare, so we won&apos;t pretend it&apos;s the
            winner.
          </p>
          <ul className="space-y-2.5">
            {nonComparable.map((r, i) => (
              <li key={i} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-paper-100">{r.name}</span>
                  {r.landed_cost !== null && (
                    <span className="tnum text-paper-400">({money(r.landed_cost)})</span>
                  )}
                  <span className="badge border border-warn/40 bg-warn/15 text-warn-soft">{r.rejection}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-paper-400">
                  {r.price_basis === "facility_only"
                    ? "Facility fee only. The professional read is billed separately, so it isn't a complete price."
                    : r.rejection === "LOW_CONFIDENCE"
                      ? "The call quality was too low to trust the number."
                      : r.summary}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* No-quote bucket */}
      {noQuote.length > 0 && (
        <section aria-labelledby="noquote-heading">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-paper-500" aria-hidden />
            <h2 id="noquote-heading" className="font-serif text-xl">
              No quote
            </h2>
          </div>
          <p className="mb-4 text-sm text-paper-400">Reached, but no usable cash price.</p>
          <ul className="space-y-2">
            {noQuote.map((r, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-sm text-paper-400">
                <span className="text-paper-200">{r.name}</span>
                <span aria-hidden>·</span>
                <span>{r.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

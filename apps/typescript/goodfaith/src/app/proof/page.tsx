// File: src/app/proof/page.tsx
import { loadFixture } from "@/lib/fixtures";
import { normalizeCallTask } from "@/lib/normalize";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import fairPrices from "../../../data/fair-prices.json";
import type { FairPrices } from "@/lib/normalize";

// E-2: four LOAD-BEARING integration surfaces headlined; webhook/events "also
// implemented"; Goals optional/stretch. No "deepest integration"/"10/10" claims.
const LOAD_BEARING = [
  {
    title: "1. Multi-recipient parallel calls",
    body: "One CALL-E task fans out to every clinic at once via recipients[], so the whole shortlist is dialed in parallel and rolls up into a single result.",
    file: "lib/calle.ts · createQuoteCall",
  },
  {
    title: "2. Per-recipient structured extraction",
    body: "We request a locked recipient_result_schema (cash_price, price_basis, includes/excludes, quoted sentence). The current CALL-E API tier rejects server-side JSON schemas (400 not supported), so we derive each field deterministically from the returned summary and transcript, and still refuse to rank any price we cannot trace to a real quoted sentence.",
    file: "lib/schemas.ts + lib/extract.ts",
  },
  {
    title: "3. Completion-confidence gating",
    body: "CALL-E's completion_confidence score gates the ranking: any call below 0.6 is held back for review and never ranked, fail-closed.",
    file: "lib/normalize.ts · CONFIDENCE_THRESHOLD",
  },
  {
    title: "4. Evidence / transcript audit trail",
    body: "Every ranked price is traced back to the exact transcript turn it was said in. A price with no traceable utterance is refused, not ranked.",
    file: "components/AuditTrail.tsx + lib/normalize.ts · findEvidence",
  },
];

const ALSO = [
  "Idempotent webhook receiver keyed on CALL-E-Event-Id: a re-delivered terminal event is a no-op (api/calle/webhook).",
  "Live call-events stream surfaced to the console (api/quotes/[id]/events → calls.listEvents).",
  "metadata.rfq_id correlation carried across the call and the webhook.",
  "Server-side credentials only + mock-first default: no key ever reaches the browser (lib/env.ts).",
];

const STRETCH = [
  "Optional Goals API path (runAndWait, per-run idempotency key) when CALLE_GOAL_ID is set: a reusable published Goal per clinic (lib/calle.ts · maybeRunGoal).",
];

export default function ProofPage() {
  const task = loadFixture("72148");
  const n = normalizeCallTask(task, fairPrices as FairPrices, "72148");
  const winner = n.results.find((r) => r.ranked);
  return (
    <>
      <SiteHeader mode="mock" />
      <main id="main" className="mx-auto max-w-5xl space-y-12 px-6 pb-4 pt-12">
        <div className="max-w-2xl">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1 text-xs font-medium uppercase tracking-widest text-accent">
            Judge proof
          </p>
          <h1 className="font-serif text-4xl tracking-tight">How the CALL-E integration works</h1>
          <p className="mt-3 text-lg text-paper-300">
            Four surfaces do the real work. Each one is load-bearing for the result you see.
          </p>
        </div>

        <section aria-label="Load-bearing integration surfaces" className="grid gap-4 md:grid-cols-2">
          {LOAD_BEARING.map((p) => (
            <div key={p.title} className="card p-5">
              <h2 className="mb-2 font-serif text-lg text-accent">{p.title}</h2>
              <p className="text-sm leading-relaxed text-paper-300">{p.body}</p>
              <p className="mt-3 font-mono text-xs text-paper-500">{p.file}</p>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl">Also implemented</h2>
          <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-paper-300">
            {ALSO.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl">Optional / stretch</h2>
          <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-paper-400">
            {STRETCH.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>

        {winner && (
          <section className="card border-2 border-accent p-6 shadow-winner">
            <h2 className="mb-3 font-serif text-xl">Winner traced to the transcript</h2>
            <p className="flex items-baseline gap-2 text-sm">
              <span className="font-serif text-3xl tnum text-accent">${winner.landed_cost?.toLocaleString("en-US")}</span>
              <span className="text-paper-200">{winner.name}</span>
            </p>
            <blockquote className="mt-3 border-l-2 border-ink-600 pl-3 font-serif italic leading-relaxed text-paper-100">
              &ldquo;{winner.evidence?.quoted_verbatim}&rdquo;
            </blockquote>
            <p className="mt-2 text-xs tnum text-paper-500">at {winner.evidence?.offset_seconds}s in the transcript</p>
          </section>
        )}

        <details className="card p-5">
          <summary className="cursor-pointer font-serif text-lg text-paper-200 transition-colors hover:text-paper-100">
            Sample rollup (result_schema JSON)
          </summary>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-ink-950/60 p-4 text-xs leading-relaxed text-paper-300">
            {JSON.stringify(n.rollup, null, 2)}
          </pre>
        </details>
      </main>
      <SiteFooter />
    </>
  );
}

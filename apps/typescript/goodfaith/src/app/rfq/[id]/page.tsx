// File: src/app/rfq/[id]/page.tsx
"use client";
import { use, useEffect, useState } from "react";
import { EventsTimeline } from "@/components/EventsTimeline";
import { StatusChips } from "@/components/StatusChips";
import { ComparisonTable } from "@/components/ComparisonTable";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import type { CallEvent } from "@/lib/calle-types";
import type { NormalizedResult, Benchmark } from "@/lib/normalize";

interface QuoteData {
  status: string;
  results: NormalizedResult[];
  benchmark: Benchmark;
  mode: "mock" | "live";
  procedure?: string;
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card h-44 animate-pulse-dot p-6" />
        <div className="card h-44 animate-pulse-dot p-6" />
      </div>
      <div className="card h-40 animate-pulse-dot" />
    </div>
  );
}

export default function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [data, setData] = useState<QuoteData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      const [ev, q] = await Promise.all([
        fetch(`/api/quotes/${id}/events`).then((r) => r.json()),
        fetch(`/api/quotes/${id}`).then((r) => r.json()),
      ]);
      if (!alive) return;
      if (ev.data?.events) setEvents(ev.data.events);
      if (q.error) setErr(q.error);
      else setData(q.data);
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  if (err) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-5xl px-6 py-24">
          <div className="card mx-auto max-w-md border-bad/40 p-6 text-center">
            <p className="font-serif text-xl text-bad-soft">We couldn&apos;t load this quote</p>
            <p className="mt-2 text-sm text-paper-400">{err}</p>
            <a href="/" className="btn-ghost mt-5">
              Start a new quote
            </a>
          </div>
        </main>
      </>
    );
  }

  const hasResults = !!data && data.results.length > 0;

  return (
    <>
      <SiteHeader mode={data?.mode} />

      <main id="main" className="mx-auto max-w-5xl space-y-8 px-6 pb-4 pt-10">
        <div>
          <h1 className="font-serif text-3xl tracking-tight md:text-4xl">
            {data?.procedure ? data.procedure : "Cash price comparison"}
          </h1>
          <p className="mt-1 text-sm text-paper-400">Live from the call. The winner is decided by comparability, not the lowest sticker.</p>
        </div>

        {/* E-1: whole-surface honesty banner in mock mode */}
        {data?.mode === "mock" && (
          <div className="rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3 text-sm text-paper-400">
            <span className="font-medium text-paper-200">Mock mode.</span> No phone was dialed. Everything below is
            computed from a recorded sample call and clearly badged. Live calling is implemented and reaches the
            CALL-E API; a full live run needs a recipient in a supported region (en-US verified).
          </div>
        )}

        {/* Live call board */}
        <section aria-labelledby="progress-heading" className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="progress-heading" className="flex items-center gap-2 text-sm font-medium text-paper-300">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
              Call progress
            </h2>
          </div>
          {data ? (
            <div className="mb-4">
              <StatusChips results={data.results} />
            </div>
          ) : null}
          <details className="group mt-1 text-xs">
            <summary className="inline-flex cursor-pointer items-center gap-1.5 text-paper-500 transition-colors hover:text-paper-300">
              Raw call-event stream
            </summary>
            <div className="mt-3 border-t border-ink-800 pt-3">
              <EventsTimeline events={events} />
            </div>
          </details>
        </section>

        {hasResults ? (
          <ComparisonTable results={data!.results} benchmark={data!.benchmark} mode={data!.mode} />
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-paper-400">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
              Waiting for the clinics to answer and quote…
            </p>
            <ResultsSkeleton />
          </div>
        )}
      </main>

      <SiteFooter />
    </>
  );
}

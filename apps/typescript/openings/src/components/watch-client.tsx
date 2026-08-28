"use client";

import { useState, useTransition } from "react";
import { runWatchOnce, stopWatch, watchState } from "@/app/actions";
import { statsFromResults } from "@/core/watch";
import { maskE164, provenanceLabel as pl } from "@/core/frame";
import { specialtyLabel } from "@/core/specialties";
import type { LineCallResult, Watch } from "@/core/types";

const VERDICT_META: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  open: { label: "Open", className: "text-emerald-400", dot: "bg-emerald-400" },
  waitlist: { label: "Waitlist", className: "text-amber-400", dot: "bg-amber-400" },
  not_accepting: { label: "Not accepting", className: "text-orange-400", dot: "bg-orange-400" },
  ghost: { label: "Ghost listing", className: "text-red-400", dot: "bg-red-400" },
  unreachable: { label: "No one answered", className: "text-zinc-500", dot: "bg-zinc-500" },
  inconclusive: { label: "Reached, no answer", className: "text-sky-400", dot: "bg-sky-400" },
  declined: { label: "Declined to answer", className: "text-zinc-400", dot: "bg-zinc-400" },
  error: { label: "Call failed", className: "text-rose-400", dot: "bg-rose-400" },
  blocked: { label: "Not called", className: "text-zinc-600", dot: "bg-zinc-600" },
};

export function WatchClient({
  watch,
  runCount,
  results,
}: {
  watch: Watch;
  runCount: number;
  results: LineCallResult[];
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(watch.status);
  const [error, setError] = useState<string | null>(null);
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);

  const stats = statsFromResults(results);

  function runNow() {
    startTransition(async () => {
      const res = await runWatchOnce(watch.id);
      if (!res.ok) {
        setError(res.error ?? "Run failed.");
        return;
      }
      setError(null);
      setLastReason(res.reason ?? null);
      setCalling(true);
      void pollUntilDone(runCount);
    });
  }

  async function pollUntilDone(startRunCount: number) {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const s = await watchState(watch.id);
      if (!s.ok) {
        setError("Watch not found.");
        setCalling(false);
        return;
      }
      if (s.status !== "active" || s.runCount > startRunCount) {
        window.location.reload();
        return;
      }
    }
    setCalling(false);
    window.location.reload();
  }

  function stop() {
    startTransition(async () => {
      await stopWatch(watch.id);
      setStatus("stopped");
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Your watch</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {watch.spec.need} · {specialtyLabel(watch.spec.specialty)} · {watch.spec.plan} ·{" "}
              {watch.spec.location} · target {watch.targetOpen} open · up to{" "}
              {watch.maxCallsPerRun} calls per run
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  status === "active" ? "bg-emerald-400" : "bg-zinc-500"
                }`}
              />
              {status}
            </span>
            {status === "active" && (
              <button
                onClick={runNow}
                disabled={pending || calling}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {pending || calling ? "Calling…" : "Run now"}
              </button>
            )}
            {status === "active" && (
              <button
                onClick={stop}
                disabled={pending}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Called" value={stats.called} />
        <Stat label="Open" value={stats.open} accent="text-emerald-400" />
        <Stat label="Ghost listings" value={stats.ghost} accent="text-red-400" />
        <Stat label="No answer" value={stats.unreachable} accent="text-zinc-500" />
      </section>

      {status === "active" && runCount === 0 && results.length === 0 && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          Nothing has been called yet. Press <strong>Run now</strong> to dial the listed
          practices. Each call identifies itself as an automated assistant and asks only about
          plan acceptance and availability.
        </p>
      )}

      {calling && (
        <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-200">
          Calls are being placed. This can take a few minutes while practices answer or go to
          voicemail — the page will refresh automatically when results arrive.
        </p>
      )}

      {lastReason === "call_cap_reached" && (
        <p role="status" className="rounded-lg border border-amber-700 bg-amber-950/40 p-4 text-sm text-amber-200">
          The per-run call limit was reached before the target number of openings was confirmed.
          This run stopped early — it is not a sign that nothing is open.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Verified listings
          </h2>
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/40">
            {results.map((r) => {
              const candidate = watch.candidates.find((c) => c.id === r.candidateId);
              const meta = VERDICT_META[r.verdict] ?? VERDICT_META.blocked!;
              return (
                <li key={r.candidateId} className="flex items-start gap-3 p-4">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{candidate?.name ?? "Listing"}</span>
                      <span className={`text-sm ${meta.className}`}>{meta.label}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {candidate ? maskE164(candidate.phoneE164) : "***-****"}
                      {" · "}
                      {candidate ? pl(candidate.provenance) : ""}
                    </div>
                    {r.evidence && (
                      <p className="mt-1 text-sm italic text-zinc-400">&ldquo;{r.evidence}&rdquo;</p>
                    )}
                    {r.summary && (
                      <p className="mt-1 text-xs text-zinc-500">{r.summary}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? "text-zinc-100"}`}>{value}</div>
    </div>
  );
}

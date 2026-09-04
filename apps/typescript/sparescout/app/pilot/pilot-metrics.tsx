"use client";

import { useEffect, useState } from "react";
import type { PilotMetrics } from "../../lib/pilot-metrics";

const valueOrDash = (value: number | null, suffix = "") => value === null ? "—" : `${value}${suffix}`;

function formatSnapshotTime(value: string | undefined) {
  if (!value) return "Preparing snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

export function PilotMetricBoard() {
  const [metrics, setMetrics] = useState<PilotMetrics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/pilot/metrics", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { metrics?: PilotMetrics };
        if (!response.ok || !payload.metrics) throw new Error("Metrics unavailable");
        if (active) setMetrics(payload.metrics);
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  const hasPilot = Boolean(metrics?.liveRequests);
  const measures = [
    [valueOrDash(metrics?.medianSourcingMinutes ?? null, " min"), "Median sourcing time", "Request creation to terminal CALL-E result"],
    [valueOrDash(metrics?.contactRate ?? null, "%"), "Completed-result rate", "Completed supplier records ÷ attempted suppliers"],
    [valueOrDash(metrics?.quoteCompleteness ?? null, "%"), "Quote completeness", "Required structured fields returned"],
    [hasPilot ? String(metrics?.compatibleOptions ?? 0) : "—", "Compatible options", "Fitment-confirmed offers across live requests"],
    [valueOrDash(metrics?.averagePriceSpread ?? null, "%"), "Average price spread", "Verified high-to-low spread where two quotes exist"],
    [valueOrDash(metrics?.humanInterventionRate ?? null, "%"), "Human intervention", "Requests with failure, missing quote, or fitment uncertainty"],
  ];

  return (
    <>
      <div className="pilot-status" role="status">
        <span>{error ? "Evidence board temporarily unavailable" : hasPilot ? `${metrics?.liveRequests} consenting live requests recorded` : "Awaiting consenting pilot calls"}</span>
        <p>{hasPilot ? `${metrics?.fixtureRunsExcluded ?? 0} fixture runs excluded from every metric.` : "No real-world performance claim is published yet."}</p>
      </div>
      <section className="measure-grid" aria-label="Pilot metrics">
        {measures.map(([value, title, definition]) => (
          <article key={title}><p>{error ? "Unavailable" : metrics ? value : "Loading verified records"}</p><h2>{title}</h2><span>{definition}</span></article>
        ))}
      </section>
      <section className="pilot-audit" aria-label="Pilot metric denominators">
        <div>
          <p className="section-kicker">Evidence denominator</p>
          <h2>Every attempt stays visible.</h2>
          <p>Counts come from durable live CALL-E records. Fixtures, failures, and incomplete outcomes are never silently converted into successes.</p>
          <a href="/api/pilot/metrics">Open machine-readable evidence snapshot <span aria-hidden="true">→</span></a>
        </div>
        <dl>
          <div><dt>Live requests</dt><dd>{metrics?.liveRequests ?? 0}</dd></div>
          <div><dt>Completed requests</dt><dd>{metrics?.completedRequests ?? 0}</dd></div>
          <div><dt>Supplier attempts</dt><dd>{metrics?.supplierAttempts ?? 0}</dd></div>
          <div><dt>Completed supplier results</dt><dd>{metrics?.successfulContacts ?? 0}</dd></div>
          <div><dt>Fixtures excluded</dt><dd>{metrics?.fixtureRunsExcluded ?? 0}</dd></div>
          <div><dt>Snapshot generated</dt><dd className="pilot-time">{formatSnapshotTime(metrics?.generatedAt)}</dd></div>
        </dl>
      </section>
    </>
  );
}

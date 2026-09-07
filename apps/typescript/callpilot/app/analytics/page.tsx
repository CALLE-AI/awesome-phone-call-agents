"use client";
import { useEffect, useState } from "react";

export default function AnalyticsPage() {
  const [a, setA] = useState({ total: 0, completed: 0, failed: 0, successRate: 0, avgDuration: 0, achieved: 0, followups: 0 });
  useEffect(() => { fetch("/api/analytics").then((r) => r.json()).then(setA); }, []);
  const cards: [string, string][] = [
    ["Total missions", String(a.total)], ["Completed", String(a.completed)],
    ["Success rate", `${Math.round(a.successRate * 100)}%`], ["Avg duration", `${a.avgDuration}s`],
    ["Objectives achieved", String(a.achieved)], ["Follow-ups required", String(a.followups)],
  ];
  return (
    <div className="pt-10">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="text-sm text-white/50 mb-6">Mission performance at a glance.</p>
      <div className="grid sm:grid-cols-3 gap-4">
        {cards.map(([k, v]) => (<div key={k} className="card p-6"><div className="label">{k}</div><div className="text-3xl font-extrabold mt-2">{v}</div>
          {k === "Success rate" && <div className="mt-3 h-2 bg-ink rounded-full overflow-hidden"><div className="h-full bg-mint" style={{ width: `${Math.round(a.successRate * 100)}%` }} /></div>}</div>))}
      </div>
    </div>
  );
}

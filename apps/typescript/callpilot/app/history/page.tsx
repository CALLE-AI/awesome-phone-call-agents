"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Mission } from "@/types";

export default function HistoryPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  useEffect(() => { fetch("/api/missions").then((r) => r.json()).then((d) => setMissions(d.missions ?? [])); }, []);
  return (
    <div className="pt-10">
      <h1 className="text-2xl font-bold">Task history</h1>
      <p className="text-sm text-white/50 mb-6">Every call is a mission. Open any result.</p>
      {!missions.length && <div className="card p-10 text-center text-white/50">No missions yet. <Link href="/missions/new" className="text-accent underline">Create one →</Link></div>}
      <div className="grid gap-3">
        {missions.map((m) => (
          <Link key={m.id} href={`/missions/${m.id}`} className="card p-5 flex flex-wrap items-center gap-4 hover:border-accent transition">
            <span className="font-mono text-xs text-white/40">#{m.number}</span>
            <div className="flex-1 min-w-[200px]"><div className="font-semibold">{m.title}</div><div className="text-xs text-white/50">{m.targetName} · {new Date(m.createdAt).toLocaleString()} · {m.elapsedSeconds}s · {m.provider === "calle-mock" ? "mocked" : "live"}</div></div>
            <span className={`text-xs font-mono border rounded-full px-3 py-1 ${m.status === "completed" ? "border-mint text-mint" : m.status === "failed" ? "border-danger text-danger" : "border-amber text-amber"}`}>{m.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

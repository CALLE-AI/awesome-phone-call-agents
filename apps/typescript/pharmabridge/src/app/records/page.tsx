"use client";
import { Archive, Bot, Droplet, FileJson, FlaskConical, Pill, Radio, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BriefView } from "@/components/BriefView";
import { Background, Footer, TopBar } from "@/components/Chrome";
import { Card, Chip, ConfidenceMeter, inputClass } from "@/components/ui";
import type { LedgerEntry, LedgerSummary } from "@/lib/ledger";
import type { AppConfig } from "@/lib/types";
import { cx } from "@/lib/ui";

const KIND_LABEL: Record<string, string> = {
  inquiry: "Stock check",
  hold: "Hold request",
  prescriber: "Prescriber routing",
  blood_inquiry: "Blood availability",
  blood_reserve: "Blood reservation",
};

export default function RecordsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [records, setRecords] = useState<LedgerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<LedgerEntry | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
    const load = () =>
      fetch("/api/records", { cache: "no-store" })
        .then(async (r) => {
          const json = await r.json();
          if (!r.ok) throw new Error(json?.error?.message ?? "Could not load call records.");
          setRecords(json.records);
        })
        .catch((e: Error) => setError(e.message));
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/records/${selected}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEntry(j.record ?? null))
      .catch(() => setEntry(null));
  }, [selected, records]);

  const missions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (records ?? []).filter((r) => !q || `${r.facility.name} ${r.needSummary} ${r.kind}`.toLowerCase().includes(q));
    const groups = new Map<string, LedgerSummary[]>();
    for (const r of list) groups.set(r.missionId, [...(groups.get(r.missionId) ?? []), r]);
    return [...groups.entries()];
  }, [records, filter]);

  const turns = entry?.call?.attempts.flatMap((a) => a.transcriptTurns) ?? [];

  function download() {
    if (!entry) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pharmabridge-call-${entry.key}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="relative min-h-screen">
      <Background />
      <TopBar config={config} />
      <div className="mx-auto max-w-7xl px-5 pb-6 pt-10">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">Call ledger</div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900">Every call, recorded</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
          PharmaBridge writes each call to a server-side ledger as it happens: the agent brief, routing, full transcript including phone-menu prompts and
          keypad presses, CALL-E events, and the structured result. Stored in <span className="font-mono text-slate-700">data/ledger/</span>.
        </p>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 lg:grid-cols-[380px_1fr]">
        <Card className="flex max-h-[76vh] flex-col overflow-hidden">
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className={cx(inputClass, "pl-9")} placeholder="Filter by facility or need" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
          <div className="scroll-thin flex-1 overflow-auto p-2">
            {error && <p className="p-3 text-sm text-rose-600">{error}</p>}
            {!error && records?.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-400">
                <Archive className="h-6 w-6" /> No calls recorded yet. Dispatch a mission and they appear here live.
              </div>
            )}
            {missions.map(([missionId, calls]) => (
              <div key={missionId} className="mb-3">
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Mission {missionId.slice(-6)} · {new Date(calls[0].createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </div>
                {calls.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setSelected(r.key)}
                    className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", selected === r.key ? "bg-violet-50 ring-1 ring-violet-200" : "hover:bg-slate-50")}
                  >
                    <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", r.needKind === "blood_bank" ? "bg-rose-50 text-rose-500" : "bg-indigo-50 text-indigo-500")}>
                      {r.needKind === "blood_bank" ? <Droplet className="h-4 w-4" /> : <Pill className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{r.facility.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {KIND_LABEL[r.kind]} · {r.status} · {r.turns} turns
                      </span>
                    </span>
                    {r.mode === "live" ? <Radio className="h-4 w-4 text-emerald-500" /> : <FlaskConical className="h-4 w-4 text-indigo-300" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card className="min-h-[60vh] p-6">
          {!entry ? (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
              <Bot className="h-7 w-7" /> Pick a call to see its transcript, result, and brief.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{KIND_LABEL[entry.kind]}</div>
                  <h2 className="font-display text-2xl font-bold text-slate-900">{entry.facility.name}</h2>
                  <p className="text-sm text-slate-500">{entry.needSummary}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip tone={entry.mode === "live" ? "emerald" : "indigo"}>{entry.mode === "live" ? `Live → ${entry.dialTarget}` : "Simulated"}</Chip>
                    <Chip>{entry.status}</Chip>
                    <Chip>{new Date(entry.createdAt).toLocaleString()}</Chip>
                    {entry.providerCallIds.map((id) => (
                      <Chip key={id} tone="violet">
                        provider {id}
                      </Chip>
                    ))}
                  </div>
                </div>
                <button onClick={download} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                  <FileJson className="h-4 w-4" /> Download JSON
                </button>
              </div>

              {entry.call?.summary && <p className="rounded-2xl bg-slate-50 p-4 text-[13.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{entry.call.summary}</p>}

              <div className="grid gap-6 xl:grid-cols-2">
                <div>
                  <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Transcript</div>
                  <div className="scroll-thin max-h-[480px] space-y-2.5 overflow-auto rounded-2xl bg-slate-50/70 p-4 ring-1 ring-slate-200">
                    {turns.length === 0 && <p className="text-sm text-slate-400">No transcript recorded.</p>}
                    {turns.map((t, i) =>
                      t.speaker === "unknown" ? (
                        <div key={i} className="text-center text-[11px] font-semibold text-amber-700">
                          {t.text}
                        </div>
                      ) : (
                        <div key={i} className={cx("flex", t.speaker === "bot" && "justify-end")}>
                          <div className={cx("max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed", t.speaker === "bot" ? "bg-violet-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}>
                            <span className="mr-1.5 font-mono text-[10px] opacity-60">{t.offsetSeconds ?? "?"}s</span>
                            {t.text}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div className="space-y-5">
                  <div>
                    <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                      Structured result
                      <ConfidenceMeter score={entry.call?.completionConfidence?.score} label={entry.call?.completionConfidence?.label} />
                    </div>
                    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                      {entry.call?.structuredResult ? (
                        Object.entries(entry.call.structuredResult).map(([k, v]) => (
                          <div key={k} className="grid grid-cols-[170px_1fr] gap-3 border-b border-slate-100 px-4 py-2 last:border-0">
                            <span className="font-mono text-[11px] text-slate-500">{k}</span>
                            <span className="text-[12.5px] text-slate-800">{v === "" || v === 0 ? <em className="text-slate-300">not stated</em> : String(v)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="p-4 text-sm text-slate-400">No structured result yet.</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Events</div>
                    <ul className="space-y-1.5">
                      {entry.events.map((e) => (
                        <li key={e.id} className="text-[12px] text-slate-600">
                          <span className="font-mono text-slate-400">{new Date(e.createdAt).toLocaleTimeString()}</span> · {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <details className="rounded-2xl bg-slate-50/60 p-4 ring-1 ring-slate-200">
                <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">Agent brief for this call</summary>
                <div className="mt-4">
                  <BriefView brief={entry.brief} />
                </div>
              </details>
            </div>
          )}
        </Card>
      </div>
      <Footer />
    </main>
  );
}

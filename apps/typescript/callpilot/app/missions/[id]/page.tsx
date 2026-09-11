"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Mission } from "@/types";

const STAGES = ["Preparing", "Dialing", "Connected", "Understanding", "Negotiating", "Confirming", "Completed"];
const STAGE_FOR: Record<string, number> = { draft: 0, planned: 0, queued: 0, dialing: 1, connected: 2, understanding: 3, negotiating: 4, confirming: 5, completed: 6, needs_review: 6, failed: 6 };

function stageIndex(m: Mission) {
  if (m.status === "planned") return 0;
  return STAGE_FOR[m.status] ?? 0;
}

export default function MissionPage({ params }: { params: { id: string } }) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [running, setRunning] = useState(false);
  const [dev, setDev] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/missions/${params.id}`, { cache: "no-store" });
    if (res.ok) setMission((await res.json()).mission);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [running, load]);

  const run = async () => {
    setRunning(true); setError(null);
    await load();
    const res = await fetch(`/api/missions/${params.id}/run`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.mission) setMission(data.mission);
    if (!res.ok) setError(data.error ?? "Call failed");
    setRunning(false);
    load();
  };

  if (!mission) return <div className="pt-16 text-white/50 font-mono text-sm">Loading mission…</div>;
  const si = stageIndex(mission);
  const r = mission.result;

  return (
    <div className="pt-10 space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="font-mono text-xs text-white/40">MISSION #{mission.number} · {mission.provider === "calle-mock" ? <span className="text-amber">MOCKED DEMO — no real call</span> : <span className="text-mint">LIVE CALL-E</span>} · {mission.status.toUpperCase()}</div>
          <h1 className="text-3xl font-extrabold mt-1">{mission.title}</h1>
          <div className="text-sm text-white/55 mt-1">Target: <b className="text-white">{mission.targetName}</b> · <span className="font-mono">{mission.phoneE164}</span> · Agent: {mission.category} · Safety: {mission.safetyMode}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDev(!dev)} className="btn-ghost !py-2 text-sm">Developer Mode {dev ? "on" : "off"}</button>
          {mission.status !== "completed" && <button onClick={run} disabled={running} className="btn-primary !py-2 disabled:opacity-50">{running ? "Calling… live updates below" : mission.callId ? "Retry call" : "Approve plan & start CALL-E call →"}</button>}
        </div>
      </div>

      {mission.provider === "calle-mock" && (
        <div className="border border-amber/50 bg-amber/10 text-amber text-xs rounded-xl px-4 py-3">Sandbox run: conversation and results are MOCKED for demonstration. Uncheck demo mode at creation + set CALLE_API_KEY for a real CALL-E call.</div>
      )}
      {error && <div className="border border-danger/50 text-danger text-sm rounded-xl px-4 py-3">{error} — no secrets exposed. Check phone format, credits, and server logs.</div>}

      {/* Timeline */}
      <div className="card p-5">
        <div className="flex items-center flex-wrap gap-1 text-[11px] font-mono">
          {STAGES.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`px-2.5 py-1 rounded-full border ${i <= si ? "border-mint text-mint" : "border-line text-white/35"} ${running && i === si ? "live" : ""}`}>{s}</span>
              {i < STAGES.length - 1 && <span className="text-white/25">→</span>}
            </span>
          ))}
        </div>
        <div className="mt-3 grid sm:grid-cols-4 gap-3 text-sm">
          <div><div className="label">Objective</div><div className="mt-1">{mission.plan?.objective}</div></div>
          <div><div className="label">Elapsed</div><div className="mt-1 font-mono">{mission.elapsedSeconds}s</div></div>
          <div><div className="label">Call / Run</div><div className="mt-1 font-mono text-xs">{mission.callId ?? "—"}{mission.calleRunId ? ` · ${mission.calleRunId}` : ""}</div></div>
          <div><div className="label">Progress</div><div className="mt-1">{r ? `${r.questionsAnswered.length}/${(mission.plan?.questions.length ?? 1)} questions` : "awaiting call"}</div></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Plan */}
        <div className="card p-6">
          <h2 className="font-bold mb-3">AI execution plan <span className="text-xs font-normal text-white/40">(review before dialing)</span></h2>
          {mission.plan && (
            <div className="text-sm space-y-3">
              <div><div className="label">Objective</div><p className="mt-1">{mission.plan.objective}</p></div>
              <div><div className="label">Questions</div><ul className="mt-1 list-disc ml-5 text-white/80">{mission.plan.questions.map((q) => <li key={q}>{q}</li>)}</ul></div>
              <div><div className="label">Constraints</div><ul className="mt-1 list-disc ml-5 text-white/80">{mission.plan.constraints.map((q) => <li key={q}>{q}</li>)}</ul></div>
              <div><div className="label">Success condition</div><p className="mt-1">{mission.plan.success_condition}</p></div>
              <div><div className="label">Guardrails ({mission.plan.safety.mode})</div><ul className="mt-1 list-disc ml-5 text-white/60 text-xs">{mission.plan.safety.guardrails.map((g) => <li key={g}>{g}</li>)}</ul></div>
            </div>
          )}
        </div>
        {/* Live feed */}
        <div className="card p-6">
          <h2 className="font-bold mb-3">Real-time event feed {running && <span className="live text-mint text-xs font-mono ml-2">● LIVE</span>}</h2>
          <div className="space-y-2 max-h-[380px] overflow-auto font-mono text-xs">
            {mission.events.map((e) => (
              <div key={e.id} className="border border-line rounded-lg px-3 py-2 bg-ink"><span className="text-white/35">{new Date(e.ts).toLocaleTimeString()}</span> <span className="text-accent">[{e.kind}]</span> <span className="text-white/85">{e.message}</span></div>
            ))}
            {!mission.events.length && <div className="text-white/40">No events yet.</div>}
          </div>
        </div>
      </div>

      {/* Result */}
      {r && (
        <div className="card p-6 sm:p-8 border-mint/30">
          <div className="font-mono text-xs text-mint mb-1">MISSION COMPLETE · {mission.provider === "calle-mock" ? "MOCKED" : "LIVE"}</div>
          <h2 className="text-2xl font-extrabold">Objective: {mission.plan?.objective}</h2>
          <div className="text-sm mt-1">Status: <b>{mission.status}</b> · Result: <b>{r.objective_achieved ? "Objective achieved" : "Needs review"}</b> · Confidence: <b>{Math.round(r.confidence * 100)}%</b></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5 text-sm">
            <div className="border border-line rounded-xl p-4"><div className="label">Available times</div>{r.availability.length ? r.availability.map((a, i) => <div key={i} className="mt-1">{a.date} · {a.time}</div>) : <div className="text-white/40 mt-1">—</div>}</div>
            <div className="border border-line rounded-xl p-4"><div className="label">Price</div><div className="mt-1">{r.price ?? "—"}</div><div className="label mt-3">Requirements</div>{r.requirements.length ? r.requirements.map((x) => <div key={x}>· {x}</div>) : <div className="text-white/40">—</div>}</div>
            <div className="border border-line rounded-xl p-4"><div className="label">Questions ✓ / ✗</div><div className="mt-1 text-mint">{r.questionsAnswered.map((x) => <div key={x}>✓ {x}</div>)}</div><div className="mt-1 text-white/45">{r.questionsUnanswered.map((x) => <div key={x}>✗ {x}</div>)}</div></div>
            <div className="border border-line rounded-xl p-4"><div className="label">Next action</div><div className="mt-1">{r.next_action}</div><div className="label mt-3">Entities</div><div className="font-mono text-xs mt-1">{r.entities.join(" · ")}</div></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4 text-sm">
            <div className="border border-line rounded-xl p-4"><div className="label">AI summary</div><p className="mt-1 text-white/80">{r.summary}</p></div>
            <div className="border border-line rounded-xl p-4"><div className="label">Recommended next step</div><p className="mt-1 text-white/80">{r.recommendedNextStep}</p>{r.notes.length > 0 && <div className="label mt-3">Notes</div>}{r.notes.map((n) => <div key={n} className="text-white/60 text-xs mt-1">· {n}</div>)}</div>
          </div>
          {r.transcriptExcerpt?.length ? (
            <div className="mt-4"><div className="label mb-2">Conversation excerpt ({mission.provider === "calle-mock" ? "mocked" : "live transcript turns"})</div>
              <div className="space-y-1 font-mono text-xs">{r.transcriptExcerpt.map((t, i) => <div key={i} className="border border-line rounded-lg px-3 py-2 bg-ink"><b className={t.speaker === "bot" ? "text-accent" : "text-mint"}>{t.speaker}</b> <span className="text-white/35">[{t.offset_seconds}s]</span> <span className="text-white/80">{t.text}</span></div>)}</div></div>
          ) : null}
        </div>
      )}

      {/* Developer mode */}
      {dev && mission.plan && (
        <div className="card p-6">
          <h2 className="font-bold font-mono text-sm mb-3">DEVELOPER MODE — CALL-E request · agent config · events · output (secrets redacted)</h2>
          <div className="grid lg:grid-cols-2 gap-4">
            <div><div className="label mb-1">CALL-E request (SDK: @call-e/calle → CalleClient.calls.createAndWait)</div><pre className="json bg-ink border border-line rounded-xl p-4">{JSON.stringify({ task_preview: mission.plan.agentInstructions.slice(0, 600) + "…", recipients: [{ phones: [mission.phoneE164] }], result_schema: mission.plan.resultSchema, baseUrl: "https://api.heycall-e.com (CALLE_BASE_URL)", auth: "Bearer CALLE_API_KEY [redacted]" }, null, 2)}</pre></div>
            <div><div className="label mb-1">Agent configuration</div><pre className="json bg-ink border border-line rounded-xl p-4">{JSON.stringify({ category: mission.category, safety: mission.plan.safety, success_condition: mission.plan.success_condition, questions: mission.plan.questions }, null, 2)}</pre></div>
            <div><div className="label mb-1">Call events ({mission.events.length})</div><pre className="json bg-ink border border-line rounded-xl p-4 max-h-64">{JSON.stringify(mission.events, null, 2)}</pre></div>
            <div><div className="label mb-1">Structured output {mission.provider === "calle-mock" ? "(MOCKED)" : "(LIVE)"}</div><pre className="json bg-ink border border-line rounded-xl p-4 max-h-64">{JSON.stringify(mission.result ?? { pending: true }, null, 2)}</pre></div>
          </div>
          {mission.error && <div className="mt-3 font-mono text-xs text-danger">ERROR: {mission.error}</div>}
        </div>
      )}

      <Link href="/history" className="btn-ghost inline-block text-sm">← Back to history</Link>
    </div>
  );
}

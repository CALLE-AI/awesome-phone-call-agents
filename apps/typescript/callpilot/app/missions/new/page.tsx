"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATES } from "@/agents/templates";
import type { MissionCategory, SafetyMode } from "@/types";

const CATS: MissionCategory[] = ["appointment", "quote", "lead", "availability", "service", "followup"];

export default function NewMissionPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "Find the earliest available appointment",
    targetName: "Example Dental Clinic",
    phoneE164: "",
    category: "appointment" as MissionCategory,
    goal: "Ask for the earliest available appointment next week.",
    questions: "What appointment times are available?\nWhat is the earliest afternoon appointment?\nWhat information is required to book?",
    constraints: "Prefer afternoon appointments.\nDo not confirm anything without user approval",
    desiredOutcome: "Obtain available appointment options",
    safetyMode: "approval_required" as SafetyMode,
    demoMode: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const applyTemplate = (id: MissionCategory) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setForm((f) => ({ ...f, category: id, goal: t.goal, questions: t.questions.join("\n"), constraints: t.constraints.join("\n"), desiredOutcome: t.desiredOutcome }));
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/missions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          questions: form.questions.split("\n").map((s) => s.trim()).filter(Boolean),
          constraints: form.constraints.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error + (data.details ? " — check phone E.164" : ""));
      router.push(`/missions/${data.mission.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  };

  return (
    <div className="pt-10 grid lg:grid-cols-[1fr_360px] gap-6">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Create a mission</h1>
        <p className="text-sm text-white/50 mb-6">Describe the job. CallPilot plans it, calls via CALL-E, and returns structured data.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><div className="label mb-1">Task title</div><input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div><div className="label mb-1">Target business / person</div><input className="input" value={form.targetName} onChange={(e) => set("targetName", e.target.value)} /></div>
          <div><div className="label mb-1">Phone (E.164)</div><input className="input font-mono" placeholder="+15551234567" value={form.phoneE164} onChange={(e) => set("phoneE164", e.target.value)} /></div>
          <div><div className="label mb-1">Category</div><select className="input" value={form.category} onChange={(e) => { set("category", e.target.value); applyTemplate(e.target.value as MissionCategory); }}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><div className="label mb-1">Safety mode</div><select className="input" value={form.safetyMode} onChange={(e) => set("safetyMode", e.target.value)}>
            <option value="info_only">Information only</option><option value="approval_required">Approval required</option><option value="autonomous">Autonomous (low-risk only)</option>
          </select></div>
          <div className="sm:col-span-2"><div className="label mb-1">Goal / objective</div><textarea className="input" rows={2} value={form.goal} onChange={(e) => set("goal", e.target.value)} /></div>
          <div><div className="label mb-1">Important questions (one per line)</div><textarea className="input font-mono text-sm" rows={5} value={form.questions} onChange={(e) => set("questions", e.target.value)} /></div>
          <div><div className="label mb-1">Constraints (one per line)</div><textarea className="input font-mono text-sm" rows={5} value={form.constraints} onChange={(e) => set("constraints", e.target.value)} /></div>
          <div className="sm:col-span-2"><div className="label mb-1">Preferred outcome</div><input className="input" value={form.desiredOutcome} onChange={(e) => set("desiredOutcome", e.target.value)} /></div>
          <label className="sm:col-span-2 flex items-center gap-3 text-sm border border-line rounded-xl px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={form.demoMode} onChange={(e) => set("demoMode", e.target.checked)} className="w-4 h-4 accent-[#7C6CFF]" />
            <span><b>Demo / sandbox mode</b> <span className="text-white/50">— mocked conversation, clearly labeled. Uncheck to place a REAL call via CALL-E (requires CALLE_API_KEY + real number).</span></span>
          </label>
        </div>
        {error && <div className="mt-4 text-sm text-danger border border-danger/40 rounded-xl px-4 py-3">{error}</div>}
        <button onClick={submit} disabled={busy} className="btn-primary mt-6 w-full disabled:opacity-50">{busy ? "Planning…" : "Generate plan & review →"}</button>
      </div>
      <div className="space-y-4">
        <div className="card p-5"><h3 className="font-bold mb-3 text-sm">Agent templates</h3><div className="space-y-2">{TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => applyTemplate(t.id)} className={`w-full text-left border rounded-xl px-4 py-3 text-sm transition ${form.category === t.id ? "border-accent bg-accent/10" : "border-line hover:border-accent"}`}>
            <div className="font-semibold">{t.name}</div><div className="text-white/50 text-xs">{t.tagline}</div>
          </button>))}</div></div>
        <div className="card p-5 text-xs text-white/55 leading-relaxed">Safety: agent identifies as AI, never makes purchases, contracts, or payments without explicit approval, and never shares sensitive data. See mission review step before dialing.</div>
      </div>
    </div>
  );
}

import Link from "next/link";

const FLOW = ["Task", "AI Plan", "CALL-E Call", "Conversation", "Structured Result", "Action"];
const TIMELINE = ["Preparing", "Dialing", "Connected", "Understanding", "Negotiating", "Confirming", "Completed"];

export default function Home() {
  return (
    <div className="pt-14">
      <section className="text-center max-w-3xl mx-auto">
        <p className="font-mono text-xs text-mint border border-line rounded-full inline-block px-3 py-1 mb-5">MISSION SYSTEM · LIVE CALL-E RUNTIME · NO FAKE CALLS</p>
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.05]">Give AI a phone.<br />Give it a job.</h1>
        <p className="mt-5 text-white/60 text-lg">CallPilot turns business tasks into real phone workflows powered by CALL-E.</p>
        <div className="mt-8 flex gap-3 justify-center">
          <Link href="/missions/new" className="btn-primary">Create a Mission</Link>
          <Link href="/history" className="btn-ghost">Explore Demo</Link>
        </div>
        <div className="card mt-10 p-5 text-left font-mono text-xs text-white/70">
          <div className="text-white/40 mb-2">MISSION #1042 · Find an available appointment · Example Business</div>
          <div className="text-mint">INTENT → PLANNING → PHONE EXECUTION → ADAPTIVE CONVERSATION → STRUCTURED DATA → ACTION</div>
        </div>
      </section>

      <section className="mt-16 grid sm:grid-cols-3 gap-4">
        {[["Don't script the call", "The agent reasons: introduces, asks, listens, adapts, follows up, and stops when the objective is achieved."], ["Humans stay in control", "Information-only, approval-required, or low-risk autonomous modes with explicit guardrails."], ["End with data, not audio", "Every call returns structured results: availability, price, requirements, next action."]].map(([t, d]) => (
          <div key={t} className="card p-6"><h3 className="font-bold mb-2">{t}</h3><p className="text-sm text-white/60">{d}</p></div>
        ))}
      </section>

      <section className="mt-12 card p-6">
        <h2 className="font-bold mb-1">How it works</h2>
        <p className="text-sm text-white/50 mb-4">Task → AI Plan → CALL-E Call → Conversation → Structured Result → Action</p>
        <div className="flex flex-wrap gap-2">
          {FLOW.map((s, i) => (
            <span key={s} className="text-xs font-mono border border-line rounded-full px-3 py-1.5 bg-ink">{i + 1}. {s}</span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {TIMELINE.map((s) => (<span key={s} className="text-[11px] font-mono text-white/50">→ {s}</span>))}
        </div>
      </section>

      <section className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[["Appointment Finder", "Earliest afternoon slot + booking requirements"], ["Quote Collector", "Itemized price, validity, requirements"], ["Lead Qualifier", "Need · budget · timeline · decision maker"], ["Availability Checker", "Open? Hours? Blackouts?"], ["Service Coordinator", "Scope · timing · access · contact"], ["Follow-Up Agent", "Status · blockers · next check-in"]].map(([t, d]) => (
          <div key={t} className="card p-5"><div className="font-semibold">{t}</div><div className="text-sm text-white/55 mt-1">{d}</div></div>
        ))}
      </section>

      <section className="mt-6 grid lg:grid-cols-2 gap-4">
        <div className="card p-6">
          <h2 className="font-bold mb-1">What a finished mission looks like</h2>
          <p className="text-sm text-white/50 mb-4">Never a transcript dump — actionable data.</p>
          <pre className="json bg-ink border border-line rounded-xl p-4 text-white/75">{JSON.stringify({ status: "completed", objective_achieved: true, availability: [{ date: "Example Date", time: "Example Time" }], requirements: ["Booking name and callback number"], next_action: "User approval required" }, null, 2)}</pre>
        </div>
        <div className="card p-6 font-mono text-xs">
          <h2 className="font-bold mb-1 font-sans text-base">Live architecture</h2>
          <p className="font-sans text-sm text-white/50 mb-4">One integration seam. Everything else is product.</p>
          <div className="bg-ink border border-line rounded-xl p-4 leading-loose text-white/75">
            <div><span className="text-accent">app/missions/new</span> → plan (planner.ts + templates)</div>
            <div><span className="text-accent">api/missions/[id]/run</span> → approve &amp; dial</div>
            <div><span className="text-mint">services/calle/calleClient.ts</span> → CalleClient.create + get</div>
            <div>→ <span className="text-mint">api/calle/webhook</span> terminal event (deduped)</div>
            <div>→ extractor.ts → structured result → dashboard</div>
          </div>
          <div className="mt-3 text-white/50">SDK: <span className="text-white/80">@call-e/calle</span> · REST fallback · secrets server-side only</div>
        </div>
      </section>

      <section className="mt-6 card p-6 grid sm:grid-cols-3 gap-4 text-sm">
        <div><h3 className="font-bold mb-1">Real CALL-E runtime</h3><p className="text-white/55"><code className="font-mono text-xs">services/calle/calleClient.ts</code> imports the official <code className="font-mono text-xs">@call-e/calle</code> SDK (<code className="font-mono text-xs">CalleClient.calls.create + get</code>) with a REST fallback. Developer Mode shows the exact request.</p></div>
        <div><h3 className="font-bold mb-1">Safety first</h3><p className="text-white/55">No unauthorized purchases, contracts, or sensitive-data disclosure. The agent identifies as AI and escalates irreversible actions for approval.</p></div>
        <div><h3 className="font-bold mb-1">Honest demo mode</h3><p className="text-white/55">Sandbox runs are watermarked MOCKED across the UI, API, and README. Nothing simulated is ever presented as a real call.</p></div>
      </section>

      <div className="mt-10 text-center">
        <Link href="/missions/new" className="btn-primary">Start your first mission</Link>
      </div>
    </div>
  );
}

import { createApp } from "@/app/app";
import { requireAuth } from "@/app/auth";
import { getConfig } from "@/app/config";
import { maskE164, provenanceLabel } from "@/core/frame";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireAuth();
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  const facts = app.listFacts();

  const ghosts = facts.filter((f) => f.factType === "line_dead");
  const total = facts.length;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Access report</h1>
        <p className="text-sm text-zinc-400">
          Verified findings accumulated by real phone calls — not directory claims. Every line
          has an evidence quote behind it.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Facts recorded</div>
          <div className="mt-1 text-3xl font-semibold">{total}</div>
        </div>
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5">
          <div className="text-xs uppercase tracking-wide text-red-300">Ghost listings found</div>
          <div className="mt-1 text-3xl font-semibold text-red-300">{ghosts.length}</div>
          {total > 0 && (
            <p className="mt-1 text-sm text-red-200/80">
              {Math.round((ghosts.length / total) * 100)}% of verified facts
            </p>
          )}
        </div>
      </section>

      {ghosts.length === 0 && (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
          No dead lines recorded yet. Run a watch to start verifying listings.
        </p>
      )}

      {ghosts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Dead lines &amp; wrong entities
          </h2>
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/40">
            {ghosts.map((f) => (
              <li key={f.id} className="p-4">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium">{f.practiceId}</span>
                  <span className="text-zinc-500">{maskE164(f.phoneE164)}</span>
                </div>
                <p className="mt-1 text-sm italic text-zinc-400">&ldquo;{f.evidence}&rdquo;</p>
                <p className="mt-1 text-xs text-zinc-600">
                  Recorded {new Date(f.recordedAt).toLocaleString()} · {provenanceLabel({ kind: "paste", source: "watch" })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

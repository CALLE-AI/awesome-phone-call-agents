import { StartWatchForm } from "@/components/start-watch-form";
import { requireAuth } from "./auth";

export default async function HomePage() {
  await requireAuth();
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          When an appointment opens, you&apos;ll be the one who knows.
        </h1>
        <p className="max-w-2xl text-zinc-400">
          Provider directories are wrong about two-thirds of the time. Openings calls the
          practices that are actually listed — not a database — verifies who is real, who takes
          your plan, and who has a slot, then keeps watching until one opens for you.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Directories with errors" value="65%" detail="of verified listings (AJMC, 2025)" />
        <Stat label="Listed providers with any opening" value="14.9%" detail="when a real person calls (AJMC, 2025)" />
        <Stat label="Per verified call" value="$0.05" detail="vs. hours of a human dialing" />
      </section>

      <StartWatchForm />
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{detail}</div>
    </div>
  );
}

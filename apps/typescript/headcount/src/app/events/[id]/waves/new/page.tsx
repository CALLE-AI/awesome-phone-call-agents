import { notFound } from "next/navigation";
import { confirmWave } from "@/app/actions";
import { ConsoleShell } from "@/components/console-shell";
import { getEvent, listInstruments } from "@/lib/queries";
import { previewNextWave } from "@/lib/wave-runner";

export default async function NewWavePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  const [instrument] = await listInstruments(id);
  const preview = previewNextWave(id);
  const blocked = preview.killed || preview.alreadyRan || preview.running || preview.wouldDial === 0;

  return (
    <ConsoleShell eventId={event.id} eventName={event.name} active="wave">
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <h1 className="text-2xl font-semibold">{instrument?.title ?? "Household needs check"}</h1>
        <p className="mt-2 text-sm text-mute">
          Wave {preview.waveNo} · {preview.targets.length} planned · {preview.wouldDial} will dial ·{" "}
          {preview.wouldRemain} remain
        </p>
        {preview.killed ? <p className="mt-3 text-sm text-critical">Kill switch is on. No new dials.</p> : null}
        {preview.running ? <p className="mt-3 text-sm text-mute">A wave is still running. Watch coverage.</p> : null}
        {preview.alreadyRan ? <p className="mt-3 text-sm text-mute">This wave already ran. Re-run is a no-op.</p> : null}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <p className="mb-3 text-sm text-mute">Who this wave dials</p>
        {preview.targets.length === 0 ? (
          <p className="text-sm text-mute">
            {preview.running
              ? "Households in this wave are already on the line."
              : "No retryable or needs-assistance households left."}
          </p>
        ) : (
          <ul className="space-y-2">
            {preview.targets.map((target) => (
              <li key={target.rosterEntryId} className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{target.displayName}</p>
                  <p className="text-xs text-mute">{target.phoneMasked}</p>
                </div>
                <p className="text-xs text-mute">{target.reason.replaceAll("_", " ")}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <p className="mb-3 text-sm text-mute">Task</p>
        <pre className="whitespace-pre-wrap text-[13px] leading-6 text-ink">{instrument?.taskText}</pre>
      </div>

      <form action={confirmWave.bind(null, event.id)} className="flex justify-end">
        <button
          type="submit"
          disabled={blocked}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white disabled:bg-line disabled:text-mute"
        >
          Confirm wave
        </button>
      </form>
    </ConsoleShell>
  );
}

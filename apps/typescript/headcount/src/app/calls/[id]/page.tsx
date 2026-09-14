import Link from "next/link";
import { notFound } from "next/navigation";
import { isReached, linkEvidence, type Disposition, type TranscriptTurn } from "@caller-ai/core";
import { ConsoleShell } from "@/components/console-shell";
import { CallReelPlayer } from "@/components/reel-player";
import { triageAttempt } from "@/lib/escalate";
import { fieldLabel, prettyValue } from "@/lib/fields";
import { getAttempt, getEvent, getInstrument, getRosterEntry, getWave } from "@/lib/queries";
import { parseJson } from "@/lib/utils";

function formatClock(seconds?: number) {
  const value = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const attempt = await getAttempt(id);
  if (!attempt) notFound();

  const household = await getRosterEntry(attempt.rosterEntryId);
  const wave = await getWave(attempt.waveId);
  const event = wave ? await getEvent(wave.eventId) : null;
  const instrument = wave ? await getInstrument(wave.instrumentId) : null;
  const inFlight = attempt.status === "in_progress";
  const result = parseJson<Record<string, unknown>>(attempt.resultJson, {});
  const turns = parseJson<TranscriptTurn[]>(attempt.transcriptJson, []);
  const evidence = parseJson<string[]>(attempt.evidenceJson, []);
  const linked = linkEvidence({ structuredResult: result, evidence, turns });
  const reached = attempt.disposition ? isReached(attempt.disposition as Disposition) : false;
  const confidence = attempt.confidenceScore ? Number(attempt.confidenceScore) : null;
  const triage = triageAttempt({
    disposition: (attempt.disposition as Disposition | null) ?? null,
    result,
    linked,
    confidence,
  });
  const reelProps = {
    household: household?.displayName ?? attempt.rosterEntryId,
    disposition: attempt.disposition ?? "pending",
    transcript_turns: turns,
    linked: linked.map((field) => ({
      field: field.field,
      value: field.value,
      supported: field.supported,
      score: field.score,
      turnText: field.turn?.text ?? null,
      turnOffset: field.turn?.offset_seconds ?? null,
    })),
  };

  return (
    <ConsoleShell eventId={event?.id} eventName={event?.name} active="call" tight>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 shadow-card">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-mute">
            <Link href={event ? `/events/${event.id}` : "/"} className="hover:text-ink">
              Coverage
            </Link>
            <span>·</span>
            <span>{wave ? `Wave ${wave.waveNo}` : "—"}</span>
            <span>·</span>
            <span>{household?.region} {household?.locale} {household?.timezone}</span>
          </div>
          <h1 className="mt-0.5 truncate text-lg font-semibold">
            {household?.displayName ?? attempt.rosterEntryId}
            <span className="ml-2 text-sm font-normal text-mute">{household?.phoneMasked}</span>
          </h1>
        </div>
        <p className={`text-sm font-medium ${inFlight ? "text-ink" : reached ? "text-safe" : "text-unaccounted"}`}>
          {prettyValue(attempt.disposition ?? (inFlight ? "on_the_line" : "pending"))}
        </p>
      </div>

      {inFlight ? (
        <p className="text-sm text-mute">This call is still in progress. Coverage will land the card when it ends.</p>
      ) : triage.dispatch ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-5 py-2.5 shadow-card">
          <p className="text-sm font-medium text-critical">Dispatch · not resolved</p>
          {triage.needs.map((need) => (
            <span key={need} className="rounded-full bg-canvas px-2.5 py-0.5 text-xs text-mute">
              {need.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-mute">
          {triage.severity === "safe"
            ? "No dispatch. Household is accounted for."
            : "Still unaccounted. Not a completed assessment."}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <section className="overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="shrink-0 border-b border-line px-5 py-2.5 text-sm font-semibold">Fields</div>
          <div>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs text-mute">
                <tr>
                  <th className="px-5 py-2 font-medium">Field</th>
                  <th className="px-5 py-2 font-medium">Value</th>
                  <th className="px-5 py-2 font-medium">On the transcript</th>
                </tr>
              </thead>
              <tbody>
                {linked.map((field) => (
                  <tr key={field.field} className="border-t border-line">
                    <td className="px-5 py-2.5 text-mute">{fieldLabel(field.field)}</td>
                    <td
                      className={`px-5 py-2.5 font-semibold ${
                        field.supported ? "text-ink" : "text-critical line-through"
                      }`}
                    >
                      {prettyValue(field.value)}
                    </td>
                    <td className={`px-5 py-2.5 text-xs ${field.supported ? "text-mute" : "text-critical"}`}>
                      {field.supported && field.turn
                        ? `“${field.turn.text}”`
                        : "Not on the transcript — send to dispatch"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="border-b border-line px-5 py-2.5 text-sm font-semibold">Transcript</div>
          <ol className="space-y-2 px-4 py-3">
            {turns.map((turn, index) => (
              <li
                key={`${turn.offset_seconds}-${index}`}
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  turn.speaker === "user" ? "ml-auto bg-canvas" : "bg-[#f7f7f7]"
                }`}
              >
                <p className="text-[11px] text-mute">
                  {turn.speaker === "user" ? "Household" : "Assistant"} · {formatClock(turn.offset_seconds)}
                </p>
                <p className="mt-0.5 text-sm leading-5">{turn.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <details className="rounded-2xl bg-white px-5 py-2 shadow-card">
        <summary className="cursor-pointer text-sm text-mute">
          Why this call? · {event?.agency} · {instrument?.title} · {event?.callbackNumber}
        </summary>
        <p className="mt-2 pb-1 text-xs text-mute">
          Opt-in roster. Region and timezone come from the household row, not the number. Key{" "}
          {attempt.idempotencyKey}
        </p>
      </details>

      <details open className="rounded-2xl bg-white px-5 py-2 shadow-card">
        <summary className="cursor-pointer text-sm text-mute">Call reel</summary>
        <div className="py-3">
          <CallReelPlayer compact {...reelProps} />
        </div>
      </details>
    </ConsoleShell>
  );
}

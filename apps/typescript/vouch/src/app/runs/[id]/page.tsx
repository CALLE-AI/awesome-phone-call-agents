import Link from "next/link";
import { notFound } from "next/navigation";
import { isReached, linkEvidence, type Disposition, type TranscriptTurn } from "@caller-ai/core";
import { ConsoleShell } from "@/components/console-shell";
import { CallReelPlayer } from "@/components/reel-player";
import { ScopeDiff } from "@/components/scope-diff";
import { fieldLabel, prettyValue, RESULT_ORDER } from "@/lib/fields";
import { getConsent, getRun } from "@/lib/queries";
import { permittedFields } from "@/lib/scope";

function formatClock(seconds?: number) {
  const value = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const consent = getConsent(run.consentId);
  if (!consent) notFound();

  const requested = JSON.parse(consent.requestedJson) as string[];
  const consentFields = JSON.parse(consent.consentFieldsJson) as string[];
  const scope = permittedFields({
    requested,
    jurisdiction: consent.jurisdiction,
    consentFields,
  });
  const result = JSON.parse(run.resultJson ?? "{}") as Record<string, unknown>;
  const turns = JSON.parse(run.transcriptJson ?? "[]") as TranscriptTurn[];
  const evidence = JSON.parse(run.evidenceJson ?? "[]") as string[];
  const linked = linkEvidence({ structuredResult: result, evidence, turns });
  const byField = new Map(linked.map((field) => [field.field, field]));
  const inFlight = run.status === "in_progress";
  const reached = run.disposition ? isReached(run.disposition as Disposition) : false;
  const rows = RESULT_ORDER.filter((field) => field in result).map((field) => byField.get(field)!);
  const reelProps = {
    household: consent.candidateName,
    disposition: run.disposition ?? "pending",
    peerLabel: "Verifier",
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
    <ConsoleShell title={`${consent.candidateName}, ${consent.employer}`} active="run">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 shadow-card">
        <div>
          <div className="flex items-center gap-2 text-xs text-mute">
            <Link href="/" className="hover:text-ink">
              Consents
            </Link>
            <span>·</span>
            <Link href={`/consents/${consent.id}`} className="hover:text-ink">
              Scope
            </Link>
          </div>
          <h1 className="mt-0.5 text-lg font-semibold">
            {consent.candidateName}
            <span className="ml-2 text-sm font-normal text-mute">{consent.phoneMasked}</span>
          </h1>
        </div>
        <p className={`text-sm font-medium ${inFlight ? "text-ink" : reached ? "text-safe" : "text-unaccounted"}`}>
          {prettyValue(run.disposition ?? (inFlight ? "on_the_line" : "pending"))}
        </p>
      </div>

      <details className="rounded-2xl bg-white px-5 py-2 shadow-card">
        <summary className="cursor-pointer text-sm text-mute">
          Why this call? · {consent.requestingOrg} · {consent.jurisdiction} · signed {consent.signedAt}
        </summary>
        <p className="mt-2 pb-1 text-xs text-mute">
          Consent {consent.id}. Employer {consent.employerId}. Key {run.idempotencyKey}. Salary history cannot reach
          the task in California.
        </p>
      </details>

      {inFlight ? (
        <p className="text-sm text-mute">This verification is still on the line. The board will land the card when it ends.</p>
      ) : null}

      <ScopeDiff requested={requested} permitted={scope.permitted} blocked={scope.blocked} />

      <div className="grid grid-cols-2 gap-3">
        <section className="overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="border-b border-line px-5 py-2.5 text-sm font-semibold">Fields</div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute">
              <tr>
                <th className="px-5 py-2 font-medium">Field</th>
                <th className="px-5 py-2 font-medium">Value</th>
                <th className="px-5 py-2 font-medium">On the transcript</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((field) => (
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
                      : field.supported
                        ? "Honest unknown"
                        : "Not on the transcript"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  {turn.speaker === "user" ? "Verifier" : "Assistant"} · {formatClock(turn.offset_seconds)}
                </p>
                <p className="mt-0.5 text-sm leading-5">{turn.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {!inFlight ? (
        <details open className="rounded-2xl bg-white px-5 py-2 shadow-card">
          <summary className="cursor-pointer text-sm text-mute">Call reel</summary>
          <div className="py-3">
            <CallReelPlayer compact {...reelProps} />
          </div>
        </details>
      ) : null}
    </ConsoleShell>
  );
}
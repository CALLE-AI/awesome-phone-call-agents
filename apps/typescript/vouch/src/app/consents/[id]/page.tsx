import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmVouchDial } from "@/app/actions";
import { ConsoleShell } from "@/components/console-shell";
import { ScopeReelPlayer } from "@/components/reel-player";
import { ScopeDiff } from "@/components/scope-diff";
import { blockCopy, consentGate } from "@/lib/consent";
import { getConsent, getKilled, latestRunForConsent, scopeTranscript } from "@/lib/queries";
import { compileVouchTask, permittedFields } from "@/lib/scope";

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const consent = getConsent(id);
  if (!consent) notFound();

  const gate = consentGate(consent);
  const killed = getKilled();
  const requested = JSON.parse(consent.requestedJson) as string[];
  const consentFields = JSON.parse(consent.consentFieldsJson) as string[];
  const scope = permittedFields({
    requested,
    jurisdiction: consent.jurisdiction,
    consentFields,
  });
  const task = compileVouchTask({
    employer: consent.employer,
    candidate: consent.candidateName,
    consentDate: consent.signedAt,
    requestingOrg: consent.requestingOrg,
    employerCode: consent.employerCode,
    permitted: scope.permitted,
  });
  const run = latestRunForConsent(consent.id);
  const blocked = !gate.ok || killed;

  return (
    <ConsoleShell title={`${consent.candidateName}, ${consent.employer}`} active="scope">
      <div className="rounded-2xl bg-white px-6 py-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-mute">
              {consent.jurisdiction}
              <span className="mx-2">·</span>
              signed {consent.signedAt}
              <span className="mx-2">·</span>
              expires {consent.expiresAt}
              <span className="mx-2">·</span>
              {consent.phoneMasked}
            </p>
            {consent.revokedAt ? (
              <p className="mt-1 text-sm font-medium text-critical">Revoked {consent.revokedAt}</p>
            ) : null}
          </div>
          {run ? (
            <Link href={`/runs/${run.id}`} className="text-sm text-mute hover:text-ink">
              Last run · {run.disposition?.replaceAll("_", " ")}
            </Link>
          ) : null}
        </div>
      </div>

      {!gate.ok ? (
        <div className="rounded-2xl bg-white px-6 py-4 shadow-card">
          <p className="text-sm font-medium text-critical">{blockCopy(gate.reason)}</p>
        </div>
      ) : null}

      {killed ? (
        <div className="rounded-2xl bg-white px-6 py-4 shadow-card">
          <p className="text-sm font-medium text-critical">Kill switch is on. No new dials.</p>
        </div>
      ) : null}

      <ScopeDiff requested={requested} permitted={scope.permitted} blocked={scope.blocked} />

      <details open className="rounded-2xl bg-white px-5 py-2 shadow-card">
        <summary className="cursor-pointer text-sm text-mute">Scope reel</summary>
        <div className="py-3">
          <ScopeReelPlayer
            candidate={consent.candidateName}
            jurisdiction={consent.jurisdiction}
            requested={requested}
            permitted={scope.permitted}
            blocked={scope.blocked}
            peerLabel="Verifier"
            transcript_turns={scopeTranscript(consent, run)}
          />
        </div>
      </details>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <p className="mb-3 text-sm text-mute">Task</p>
        <pre className="whitespace-pre-wrap text-[13px] leading-6">{task}</pre>
      </div>

      <form action={confirmVouchDial.bind(null, consent.id)} className="flex justify-end">
        <button
          type="submit"
          disabled={blocked}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white disabled:bg-line disabled:text-mute"
        >
          Confirm dial
        </button>
      </form>
    </ConsoleShell>
  );
}
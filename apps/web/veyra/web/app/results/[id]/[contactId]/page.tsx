import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import CallInFlight from "@/components/CallInFlight";
import StepHeader from "@/components/StepHeader";
import { assertResultsOperatorRole } from "@/lib/auth/live-policy";
import { callResults, campaigns, contacts } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { getSessionUser } from "@/lib/supabase/auth";
import {
  maskPhoneForDisplay,
  sanitizeDisplayError,
  sanitizeResultData,
  sanitizeSummary,
  sanitizeTranscript,
} from "@/lib/privacy/redaction";
import type { CallStatus } from "@/types/campaign";

const KICKER = "text-[10.5px] uppercase tracking-[.14em] text-bone/50";

/** CALL-E has the call and it is dialing or talking — no result exists yet. */
function inFlight(status: string): boolean {
  return status === "queued" || status === "in_progress";
}

export default async function ResultDetailPage({
  params,
}: {
  params: Promise<{ id: string; contactId: string }>;
}) {
  const { id, contactId } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/auth/login?next=/results/${id}/${contactId}`);
  try {
    assertResultsOperatorRole(user.role);
  } catch {
    redirect("/campaigns");
  }

  const loaded = await withRLS(user.id, async (tx) => {
    const [campaign] = await tx
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) return null;

    const [contact] = await tx
      .select({ id: contacts.id, name: contacts.name, phoneNumber: contacts.phoneNumber })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.campaignId, id)))
      .limit(1);
    if (!contact) return null;

    const [result] = await tx
      .select({
        qualified: callResults.qualified,
        capturedData: callResults.capturedData,
        summary: callResults.summary,
        transcript: callResults.transcript,
        status: callResults.status,
        failureMessage: callResults.failureMessage,
        calleCallId: callResults.calleCallId,
      })
      .from(callResults)
      .where(and(eq(callResults.campaignId, id), eq(callResults.contactId, contactId)))
      .limit(1);

    return { campaign, contact, result };
  });

  if (!loaded) notFound();
  const { campaign, contact, result } = loaded;

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <StepHeader current="results" />
      <main className="flex-1 px-6 pb-[72px] pt-[52px] md:px-12">
        <div className="mx-auto max-w-[820px] animate-vfade">
          <Link
            href={`/results/${id}`}
            className="mb-5 block w-fit text-xs text-bone/45 underline decoration-bone/25 underline-offset-4 hover:text-bone"
          >
            Back to {campaign.name}
          </Link>

          <h1 className="mb-2 text-4xl font-extrabold leading-[1.08] tracking-[-.02em]">
            {contact.name}
          </h1>
          <p className="mb-8 font-mono text-sm text-bone/45">
            {maskPhoneForDisplay(contact.phoneNumber)}
          </p>

          {!result ? (
            <div className="border border-bone/[.18] p-4 text-sm text-bone/45">
              This call has not been processed yet.
            </div>
          ) : inFlight(result.status) ? (
            <CallInFlight
              campaignId={id}
              contactId={contactId}
              contactName={contact.name}
              initialStatus={result.status as CallStatus}
            />
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <span className="border border-bone/[.26] px-2 py-1 font-mono text-xs text-bone/70">
                  {result.status}
                </span>
                <span
                  className={result.qualified === true ? "text-emerald-300" : "text-bone/45"}
                >
                  {result.qualified === null
                    ? "No outcome yet"
                    : result.qualified
                      ? "Qualified"
                      : "Not qualified"}
                </span>
              </div>

              {result.summary ? (
                <p className="mb-6 text-sm leading-6 text-bone/70">
                  {sanitizeSummary(result.summary)}
                </p>
              ) : null}

              {result.failureMessage ? (
                <div
                  role="alert"
                  className="mb-6 border border-red-400/50 bg-red-950/30 p-3 text-sm text-red-200"
                >
                  {sanitizeDisplayError(result.failureMessage)}
                </div>
              ) : null}

              <div className={`${KICKER} mb-2`}>Structured result</div>
              <pre className="mb-6 overflow-auto bg-panel p-3 text-xs text-bone/65">
                {JSON.stringify(sanitizeResultData(result.capturedData), null, 2)}
              </pre>

              {result.transcript ? (
                <>
                  <div className={`${KICKER} mb-2`}>Transcript</div>
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap bg-panel p-3 text-xs leading-5 text-bone/65">
                    {sanitizeTranscript(result.transcript)}
                  </pre>
                </>
              ) : null}

              {result.calleCallId ? (
                <div className="mt-6 font-mono text-[11px] text-bone/35">
                  CALL-E {result.calleCallId}
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

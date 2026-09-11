'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { CallResult, CampaignStatus, Contact } from '@/types/campaign';

const KICKER = 'text-[10.5px] uppercase tracking-[.14em] text-bone/50';
const RULE = 'border-t-2 border-bone/[.26]';

function terminal(status: CampaignStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'reconciliation_required';
}

interface ResultsListProps {
  campaignId: string;
  campaignName: string;
  initialStatus: CampaignStatus;
  initialScheduledAt: string | null;
  initialFailureMessage: string | null;
  contacts: Contact[];
  initialResults: CallResult[];
}

export default function ResultsList({
  campaignId,
  campaignName,
  initialStatus,
  initialScheduledAt,
  initialFailureMessage,
  contacts,
  initialResults,
}: ResultsListProps) {
  const [status, setStatus] = useState(initialStatus);
  const [scheduledAt, setScheduledAt] = useState(initialScheduledAt);
  const [failureMessage, setFailureMessage] = useState(initialFailureMessage);
  const [results, setResults] = useState(initialResults);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/campaigns/${campaignId}/results`, {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      status?: CampaignStatus;
      results?: CallResult[];
      scheduledAt?: string | null;
      failureMessage?: string | null;
    };
    if (body.status) setStatus(body.status);
    if (Array.isArray(body.results)) setResults(body.results);
    if (body.scheduledAt !== undefined) setScheduledAt(body.scheduledAt);
    if (body.failureMessage !== undefined) setFailureMessage(body.failureMessage);
  }, [campaignId]);

  useEffect(() => {
    if (terminal(status)) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  const notLaunched = status === 'draft' || status === 'compiled';

  return (
    <main className="flex-1 px-6 pb-[72px] pt-[52px] md:px-12">
      <div className="mx-auto max-w-[940px] animate-vfade">
        <Link
          href={`/campaigns/${campaignId}`}
          className="mb-5 block w-fit text-xs text-bone/45 underline decoration-bone/25 underline-offset-4 hover:text-bone"
        >
          Back to campaign
        </Link>

        <div className="mb-6 inline-flex items-center gap-[9px] border border-flame/60 px-[11px] py-1.5 text-[11px] uppercase tracking-[.1em] text-blush">
          <span className="size-1.5 bg-flame" />
          {status}
        </div>

        <h1 className="mb-[34px] text-4xl font-extrabold leading-[1.08] tracking-[-.02em]">
          {campaignName}
        </h1>

        {failureMessage && (status === 'failed' || status === 'reconciliation_required') ? (
          <div
            role="alert"
            className="mb-6 border border-red-400/50 bg-red-950/30 p-3 text-sm text-red-200"
          >
            {failureMessage}
          </div>
        ) : null}

        <div className={`pt-[22px] ${RULE}`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className={`${KICKER} mb-2`}>Call results</div>
              <p className="text-[13px] text-bone/55">
                {status === 'reconciliation_required'
                  ? 'Calling is paused. Reconcile the uncertain submission in CALL-E before taking further action.'
                  : terminal(status)
                  ? 'Every call reached a recorded terminal state.'
                  : status === 'scheduled'
                    ? `Scheduled for ${
                        scheduledAt ? new Date(scheduledAt).toLocaleString() : 'dispatch'
                      }. Calls have not been placed yet.`
                    : notLaunched
                      ? "This campaign hasn't been launched yet."
                      : 'Waiting for CALL-E terminal webhooks; this view refreshes automatically.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void refresh()}
                className="border border-bone/[.26] bg-transparent px-3 py-2 text-xs text-bone/70"
              >
                Refresh
              </button>
              <a
                href={`/api/campaigns/${campaignId}/results/export`}
                className="border border-bone/[.26] bg-transparent px-3 py-2 text-xs text-bone/70 no-underline"
              >
                Export CSV
              </a>
            </div>
          </div>

          {notLaunched ? (
            <div className="border border-bone/[.18] p-4 text-sm text-bone/45">
              <Link
                href={`/campaigns/${campaignId}`}
                className="text-blush underline decoration-blush/40 underline-offset-4"
              >
                Go to the campaign
              </Link>{' '}
              to add contacts and launch it.
            </div>
          ) : results.length === 0 ? (
            <div className="border border-bone/[.18] p-4 text-sm text-bone/45">
              Processing calls&hellip; results will appear here automatically.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {results.map((result) => {
                const contact = contacts.find((item) => item.id === result.contactId);
                return (
                  <Link
                    key={result.id}
                    href={`/results/${campaignId}/${result.contactId}`}
                    className="flex flex-col gap-2 border border-bone/[.18] bg-panel p-4 no-underline hover:border-bone/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-extrabold text-bone">
                        {contact?.name ?? 'Unknown contact'}
                      </span>
                      <span className="font-mono text-xs text-bone/50">{result.status}</span>
                    </div>
                    <span
                      className={result.qualified === true ? 'text-emerald-300' : 'text-bone/45'}
                    >
                      {result.qualified === null
                        ? 'No outcome yet'
                        : result.qualified
                          ? 'Qualified'
                          : 'Not qualified'}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

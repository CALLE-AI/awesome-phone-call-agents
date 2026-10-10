'use client';

import { useCallback, useEffect, useState } from 'react';
import { proxied, ApiError } from '@/lib/api';
import type { BusinessRunSummaryDto } from '@dial/schemas';

/**
 * The call history. A run expands to each person called and what they said.
 *
 * This screen used to print `JSON.stringify(structuredResult, null, 2)` into
 * the page and label rows with raw state names -- `partially_completed`,
 * `needs_review`, `answered_no_answer_to_question`. That is Dial's internal
 * vocabulary, and a business owner should never have to read it to find out
 * whether a customer confirmed. The same values are now written as words, with
 * the raw result kept behind a disclosure for when someone genuinely wants it.
 */

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Run states, in the words an owner would use. */
const RUN_STATE_LABELS: Record<string, string> = {
  queued: 'Waiting to start',
  running: 'Calling now',
  completed: 'Finished',
  partially_completed: 'Finished with gaps',
  failed: 'Could not complete',
  canceled: 'Canceled',
};

const RUN_STATE_TONES: Record<string, string> = {
  queued: 'info',
  running: 'info',
  completed: 'success',
  partially_completed: 'warning',
  failed: 'danger',
  canceled: 'neutral',
};

/** Per-recipient outcomes, across every template. */
const OUTCOME_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  cancel_requested: 'Wants to cancel',
  reschedule_requested: 'Wants to reschedule',
  time_agreed: 'Time agreed',
  callback_requested: 'Asked for a callback',
  interested: 'Interested',
  not_interested: 'Not interested',
  completed: 'Done',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  needs_review: 'Needs your review',
  other: 'Other',
};

const OUTCOME_TONES: Record<string, string> = {
  confirmed: 'success',
  time_agreed: 'success',
  completed: 'success',
  interested: 'success',
  cancel_requested: 'warning',
  reschedule_requested: 'warning',
  callback_requested: 'warning',
  needs_review: 'warning',
  not_interested: 'neutral',
  no_answer: 'neutral',
  wrong_number: 'danger',
};

/** Recipient states, for rows that never reached an outcome. */
const RECIPIENT_STATE_LABELS: Record<string, string> = {
  pending: 'Not called yet',
  calling: 'Calling now',
  completed: 'Called',
  failed: 'Could not be reached',
  skipped: 'Skipped',
  canceled: 'Canceled',
};

function humanise(value: string, table: Record<string, string>): string {
  return table[value] ?? value.replace(/_/g, ' ');
}

/**
 * The structured result as sentences.
 *
 * Field names come straight from the template schemas, so they are known here
 * rather than guessed; anything unrecognised is title-cased instead of being
 * dropped, since a result Dial cannot label is still a result the owner paid
 * for.
 */
const RESULT_FIELD_LABELS: Record<string, string> = {
  requested_time: 'Time they suggested',
  preferred_date: 'Preferred date',
  preferred_time_window: 'Preferred time',
  note: 'What they said',
  evidence_summary: 'What Dial heard',
  requested_callback: 'Asked to be called back',
  confidence: 'Confidence',
};

const HIDDEN_RESULT_FIELDS = new Set(['outcome']);

function resultRows(result: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(result)) {
    if (HIDDEN_RESULT_FIELDS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    if (value === false) continue;
    const label =
      RESULT_FIELD_LABELS[key] ??
      key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    rows.push([label, value === true ? 'Yes' : String(value)]);
  }
  return rows;
}

interface Recipient {
  id: string;
  recipientName: string;
  phoneMasked: string;
  state: string;
  disposition: string | null;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  failureMessage: string | null;
  transcript: Array<{ offsetSeconds: number; speaker: string; text: string }>;
}

interface RunDetail {
  run: BusinessRunSummaryDto & { recipients: Recipient[] };
}

export function RunsView({ businessId }: { businessId: string }) {
  const [runs, setRuns] = useState<BusinessRunSummaryDto[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    proxied
      .listRuns(businessId)
      .then((r) => setRuns(r.runs))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Could not load calls.'));
  }, [businessId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function open(runId: string) {
    if (openRun === runId) {
      setOpenRun(null);
      setDetail(null);
      return;
    }
    setOpenRun(runId);
    setDetail(null);
    try {
      const result = await proxied.getRun(businessId, runId);
      setDetail(result as unknown as RunDetail);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load that run.');
    }
  }

  async function cancel(runId: string) {
    try {
      await proxied.cancelRun(businessId, runId);
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not cancel that run.');
    }
  }

  return (
    <>
      <div className="business-toolbar">
        <div>
          <h2 className="business-toolbar-title">Calls</h2>
          <p className="business-toolbar-sub">Every run, and what each person said.</p>
        </div>
      </div>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {runs === null ? (
        <section className="card" aria-busy="true">
          <div className="skeleton skeleton-line" style={{ width: '45%' }} />
          <div className="skeleton skeleton-line" style={{ width: '70%' }} />
        </section>
      ) : runs.length === 0 ? (
        <section className="card">
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
            No calls yet. Choose a workflow, pick who to call, and the results appear here.
          </p>
        </section>
      ) : (
        runs.map((run) => {
          const isOpen = openRun === run.id;
          return (
            <section key={run.id} className="card">
              <button
                type="button"
                className="business-run-summary"
                aria-expanded={isOpen}
                onClick={() => void open(run.id)}
              >
                <span>
                  <span className="business-result-line">
                    {run.workflowName ?? 'Workflow'} · {formatWhen(run.scheduledAt)}
                  </span>
                  <span className="business-result-meta" style={{ display: 'block' }}>
                    {describeStats(run.stats)}
                  </span>
                </span>
                <span
                  className="business-chip"
                  data-tone={RUN_STATE_TONES[run.state] === 'neutral' ? undefined : RUN_STATE_TONES[run.state]}
                >
                  {humanise(run.state, RUN_STATE_LABELS)}
                </span>
              </button>

              {run.state === 'queued' || run.state === 'running' ? (
                <div className="button-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="button" data-variant="danger" onClick={() => void cancel(run.id)}>
                    Stop these calls
                  </button>
                </div>
              ) : null}

              {isOpen ? (
                detail === null ? (
                  <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
                ) : (
                  <div style={{ marginTop: 'var(--space-lg)' }}>
                    {detail.run.recipients.map((recipient) => (
                      <RecipientResult key={recipient.id} recipient={recipient} />
                    ))}
                  </div>
                )
              ) : null}
            </section>
          );
        })
      )}
    </>
  );
}

/** "3 confirmed · 1 no answer" rather than a dump of the stats object. */
function describeStats(stats: Record<string, number>): string {
  const entries = Object.entries(stats);
  if (entries.length === 0) return 'No results yet.';
  return entries
    .map(([key, count]) => `${count} ${humanise(key, OUTCOME_LABELS).toLowerCase()}`)
    .join(' · ');
}

function RecipientResult({ recipient }: { recipient: Recipient }) {
  const outcome = recipient.disposition;
  const label = outcome
    ? humanise(outcome, OUTCOME_LABELS)
    : humanise(recipient.state, RECIPIENT_STATE_LABELS);
  const tone = outcome ? OUTCOME_TONES[outcome] : undefined;
  const rows = recipient.structuredResult ? resultRows(recipient.structuredResult) : [];

  return (
    <div className="business-recipient">
      <div className="business-recipient-head">
        <div>
          <span className="business-result-line">{recipient.recipientName}</span>{' '}
          <span className="business-result-meta">{recipient.phoneMasked}</span>
        </div>
        <span className="business-chip" data-tone={tone === 'neutral' ? undefined : tone}>
          {label}
        </span>
      </div>

      {recipient.summary ? <p className="business-recipient-note">{recipient.summary}</p> : null}
      {recipient.failureMessage ? (
        <p className="business-recipient-note">{recipient.failureMessage}</p>
      ) : null}

      {rows.length > 0 ? (
        <dl className="business-facts">
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {recipient.transcript.length > 0 ? (
        <details className="business-transcript">
          <summary>Transcript ({recipient.transcript.length} turns)</summary>
          <div className="business-transcript-body">
            {recipient.transcript.map((turn, index) => (
              <p key={index}>
                <strong>
                  {turn.speaker === 'bot' ? 'Dial' : turn.speaker === 'user' ? recipient.recipientName : '—'}
                </strong>{' '}
                {turn.text}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

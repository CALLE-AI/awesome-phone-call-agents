'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { proxied, ApiError } from '@/lib/api';
import type { BusinessDashboard, BusinessDto } from '@dial/schemas';

/**
 * The business dashboard: summary cards, upcoming calls, and recent results
 * written as sentences a person can act on.
 */

/**
 * The same outcome words and tones the call list uses. Raw keys like
 * `cancel_requested` are Dial's vocabulary, not the owner's.
 */
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

const OUTCOME_TONES: Record<string, string | undefined> = {
  confirmed: 'success',
  time_agreed: 'success',
  completed: 'success',
  interested: 'success',
  cancel_requested: 'warning',
  reschedule_requested: 'warning',
  callback_requested: 'warning',
  needs_review: 'warning',
  wrong_number: 'danger',
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BusinessDashboard({ business }: { business: BusinessDto }) {
  const [data, setData] = useState<BusinessDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    proxied
      .businessDashboard(business.id)
      .then(setData)
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load the dashboard.'),
      );
  }, [business.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <>
      <div className="business-toolbar">
        <div>
          <h2 className="business-toolbar-title">Overview</h2>
          <p className="business-toolbar-sub">What Dial is doing for you today.</p>
        </div>
        <Link className="button" data-variant="primary" href={`/business/${business.id}/workflows/new`}>
          New workflow
        </Link>
      </div>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {data === null ? (
        <div className="business-stat-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card business-stat">
              <div className="skeleton" style={{ width: 48, height: 30 }} />
              <div className="skeleton skeleton-line" style={{ width: '70%' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="business-stat-grid">
            <div className="card business-stat">
              <div className="business-stat-number">{data.callsToday}</div>
              <div className="business-stat-label">Calls today</div>
            </div>
            <div className="card business-stat">
              <div className="business-stat-number">{data.scheduled}</div>
              <div className="business-stat-label">Scheduled</div>
            </div>
            <div className="card business-stat">
              <div className="business-stat-number">{data.completedToday}</div>
              <div className="business-stat-label">Completed today</div>
            </div>
            <div className="card business-stat" data-tone={data.needsAttention > 0 ? 'attention' : undefined}>
              <div className="business-stat-number">{data.needsAttention}</div>
              <div className="business-stat-label">Needs attention</div>
            </div>
          </div>

          {Object.keys(data.outcomeTally).length > 0 ? (
            <section className="card">
              <div className="card-label">Outcomes</div>
              <div className="business-chip-row">
                {Object.entries(data.outcomeTally).map(([outcome, count]) => (
                  <span key={outcome} className="business-chip" data-tone={OUTCOME_TONES[outcome]}>
                    {OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, ' ')}
                    <span className="business-chip-count">{count}</span>
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card">
            <div className="card-label">Upcoming calls</div>
            {data.upcoming.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
                Nothing scheduled. Pick a workflow to run, or schedule one from Contacts.
              </p>
            ) : (
              data.upcoming.map((item) => (
                <div key={item.recipientId} className="business-result-row">
                  <div>
                    <div className="business-result-line">
                      {item.recipientName} · {item.workflowName ?? 'workflow'}
                    </div>
                    <div className="business-result-meta">{formatWhen(item.scheduledAt)}</div>
                  </div>
                  <span className="business-chip">scheduled</span>
                </div>
              ))
            )}
          </section>

          <section className="card">
            <div className="card-label">Recent results</div>
            {data.recent.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>No calls yet.</p>
            ) : (
              data.recent.map((item) => (
                <Link
                  key={item.recipientId}
                  href={`/business/${business.id}/runs`}
                  className="business-result-row"
                  style={{ display: 'flex', textDecoration: 'none', color: 'inherit' }}
                >
                  <div>
                    <div className="business-result-line">{item.line}</div>
                    <div className="business-result-meta">
                      {item.workflowName ?? 'workflow'}
                      {item.completedAt ? ` · ${formatWhen(item.completedAt)}` : ''}
                    </div>
                  </div>
                  {item.outcomeLabel ? <span className="business-chip">{item.outcomeLabel}</span> : null}
                </Link>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}

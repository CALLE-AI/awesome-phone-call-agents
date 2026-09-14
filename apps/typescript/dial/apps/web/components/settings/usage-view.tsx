'use client';

import { useEffect, useState } from 'react';
import type { UsageResponse } from '@dial/schemas';
import { proxied, ApiError } from '@/lib/api';

/**
 * What this account has actually used.
 *
 * The figures come from `usage_counters` — the same rows the call budget is
 * enforced against — rather than a second tally counted somewhere else, so
 * the number shown here is the number that stopped the work. Nothing on this
 * page is estimated, and there is no billing figure because Dial does not
 * charge for calls.
 */
export function UsageView() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    proxied
      .getUsage(14)
      .then(setUsage)
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load your usage.'),
      );
  }, []);

  if (error) {
    return (
      <div className="notice" data-tone="danger" role="alert">
        {error}
      </div>
    );
  }

  if (!usage) {
    return (
      <section className="card" aria-busy="true">
        <div className="skeleton skeleton-line" style={{ width: '35%' }} />
        <div className="skeleton skeleton-line" style={{ width: '60%' }} />
      </section>
    );
  }

  const remaining = Math.max(0, usage.limits.callsPerDay - usage.today.callsPlaced);
  const usedFraction =
    usage.limits.callsPerDay > 0
      ? Math.min(1, usage.today.callsPlaced / usage.limits.callsPerDay)
      : 0;
  const busiest = Math.max(1, ...usage.history.map((d) => d.callsPlaced));

  return (
    <>
      <section className="card">
        <div className="card-label">Today</div>

        <div className="usage-headline">
          <span className="usage-number">{usage.today.callsPlaced}</span>
          <span className="usage-of">of {usage.limits.callsPerDay} calls</span>
        </div>

        {/*
          A meter, not a decorative bar: the same element a screen reader can
          announce with its value and its ceiling.
        */}
        <div
          className="usage-meter"
          role="meter"
          aria-valuenow={usage.today.callsPlaced}
          aria-valuemin={0}
          aria-valuemax={usage.limits.callsPerDay}
          aria-label="Calls placed today"
        >
          <span
            className="usage-meter-fill"
            data-full={usedFraction >= 1 || undefined}
            style={{ width: `${usedFraction * 100}%` }}
          />
        </div>

        <p className="field-hint">
          {remaining === 0
            ? 'You have used today’s calls. The limit resets at midnight UTC.'
            : `${remaining} call${remaining === 1 ? '' : 's'} left today. Resets at midnight UTC.`}
        </p>

        <dl className="settings-facts" style={{ marginTop: 'var(--space-lg)' }}>
          <div>
            <dt>Tasks started today</dt>
            <dd>{usage.today.tasksCreated}</dd>
          </div>
          <div>
            <dt>Calls one task may place</dt>
            <dd>{usage.limits.callsPerTask}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="card-label">Last 14 days</div>

        {usage.totals.callsPlaced === 0 && usage.totals.tasksCreated === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
            No calls yet. Once Dial rings someone for you, it shows up here.
          </p>
        ) : (
          <>
            <ol className="usage-chart">
              {usage.history.map((day) => (
                <li key={day.day}>
                  <span
                    className="usage-bar"
                    style={{ height: `${(day.callsPlaced / busiest) * 100}%` }}
                    data-empty={day.callsPlaced === 0 || undefined}
                  />
                  <span className="usage-bar-label">{shortDay(day.day)}</span>
                  <span className="visually-hidden">
                    {day.callsPlaced} call{day.callsPlaced === 1 ? '' : 's'} on {day.day}
                  </span>
                </li>
              ))}
            </ol>

            <dl className="settings-facts" style={{ marginTop: 'var(--space-lg)' }}>
              <div>
                <dt>Calls placed</dt>
                <dd>{usage.totals.callsPlaced}</dd>
              </div>
              <div>
                <dt>Tasks started</dt>
                <dd>{usage.totals.tasksCreated}</dd>
              </div>
            </dl>
          </>
        )}
      </section>
    </>
  );
}

/** "25 Aug" from "2026-08-25", without letting a timezone move the day. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${Number(day)} ${months[Number(month) - 1] ?? ''}`.trim();
}

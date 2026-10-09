import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LearningSummary, RepairRule } from '../domain/model';
import { InlineError } from './Shared';

export function Learning() {
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let canceled = false;
    void api<LearningSummary>('/learning').then(
      (value) => {
        if (!canceled) setSummary(value);
      },
      (e: Error) => {
        if (!canceled) setError(e.message);
      },
    );
    return () => {
      canceled = true;
    };
  }, []);
  async function reset(id: RepairRule) {
    setBusy(true);
    setError('');
    try {
      setSummary(await api<LearningSummary>(`/learning/${id}`, 'DELETE'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset correction feedback.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="read-access-panel" aria-labelledby="learning-heading" aria-busy={busy}>
      <h3 id="learning-heading">Learning from your reviews</h3>
      <p>
        ReadyCheck remembers which automatic corrections you accept. Accepted corrections add
        reminders to future inquiry plans. Rejecting or editing one pauses that correction method.
      </p>
      <p className="small muted">
        Memory belongs to this account. Every corrected live answer still needs review.
      </p>
      {error ? <InlineError message={error} /> : null}
      {!summary && !error ? <p role="status">Loading correction feedback…</p> : null}
      {summary?.rules.map((rule) => (
        <div className="read-access-result" key={rule.id}>
          <strong>{rule.label}</strong>
          <p role="status">
            {rule.status === 'paused'
              ? 'Paused after a rejected correction'
              : rule.status === 'active'
                ? 'Using reviewed lessons'
                : 'Awaiting your first review'}{' '}
            · {rule.accepted} accepted · {rule.rejected} rejected
          </p>
          {rule.accepted + rule.rejected > 0 ? (
            <button className="text-button" disabled={busy} onClick={() => void reset(rule.id)}>
              Reset {rule.label.toLowerCase()}
            </button>
          ) : null}
        </div>
      ))}
      <p className="small muted">
        Resetting forgets feedback for that method and allows new correction proposals. Saved
        evidence stays available; changed lessons require a fresh call preview.
      </p>
    </section>
  );
}

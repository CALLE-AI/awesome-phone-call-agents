'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { registerCaseNavigation } from '@/lib/webmcp';
import type { Job } from '@/lib/domain';
export default function Page() {
  const [jobs, setJobs] = useState<Job[]>([]),
    [id, setId] = useState(''),
    [name, setName] = useState('Practice customer'),
    [phone, setPhone] = useState(''),
    [purpose, setPurpose] = useState(
      'Ask whether a replacement pickup tomorrow between 3 and 4 pm is possible. Do not book it.',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [token, setToken] = useState(''),
    [live, setLive] = useState(false);
  useEffect(
    () => registerCaseNavigation(setId, (id) => jobs.some((j) => j.id === id)),
    [jobs],
  );
  const job = jobs.find((j) => j.id === id);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, id, ...extra }),
      });
      const d = (await r.json()) as {
        jobs: Job[];
        id?: string;
        error?: string;
      };
      if (!r.ok) throw Error(d.error || 'Request failed');
      setJobs(d.jobs);
      if (d.id) setId(d.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    fetch('/api/jobs')
      .then(
        (r) =>
          r.json() as Promise<{ jobs: Job[]; live?: boolean; error?: string }>,
      )
      .then((d) => {
        setJobs(d.jobs || []);
        setLive(!!d.live);
        if (d.error) setError(d.error);
      })
      .catch(() => setError('Could not load cases.'));
  }, []);
  return (
    <main>
      <header>
        <strong>◉ PickupProof</strong>
        <span>RECOVERY DESK</span>
        <small>
          {live
            ? 'Live service configured'
            : 'Practice workspace · no calls placed'}
        </small>
      </header>
      <div className="heading">
        <p className="eyebrow">MISSED PICKUP → VERIFIED NEXT STEP</p>
        <h1>Every recovery has a receipt.</h1>
        <p>Review the call. Check the evidence. Confirm the next step.</p>
      </div>
      <div className="workspace">
        <aside>
          <h2>
            Recovery queue <small>{jobs.length}</small>
          </h2>
          {jobs.map((j) => (
            <button
              key={j.id}
              className={'queue ' + (id === j.id ? 'chosen' : '')}
              onClick={() => setId(j.id)}
            >
              <strong>{j.name}</strong>
              <span>{j.state.replaceAll('_', ' ')}</span>
              <small>{j.mode}</small>
            </button>
          ))}
          {!jobs.length && (
            <p className="quiet">
              Start with a synthetic customer to try the complete workflow.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act('create', { name, phone, purpose, mode: 'practice' });
            }}
          >
            <h3>New recovery</h3>
            <label htmlFor="customer">
              Customer
              <Input
                id="customer"
                required
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label htmlFor="purpose">
              Allowed request
              <Textarea
                id="purpose"
                required
                value={purpose}
                maxLength={1500}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </label>
            <Button disabled={busy}>Create practice case →</Button>
            {live && (
              <>
                <label htmlFor="phone">
                  Phone
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91…"
                  />
                </label>
                <label htmlFor="operator-token">
                  Operator token
                  <Input
                    id="operator-token"
                    type="password"
                    value={token}
                    autoComplete="off"
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  disabled={busy || !token}
                  onClick={() =>
                    act('create', { name, phone, purpose, mode: 'live' })
                  }
                >
                  Create live case
                </Button>
              </>
            )}
          </form>
        </aside>
        <section className="detail">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {job ? (
            <>
              <div className="sectiontitle">
                <div>
                  <p className="eyebrow">{job.mode.toUpperCase()} CASE</p>
                  <h2>{job.name}</h2>
                </div>
                <span className="status">{job.state.replaceAll('_', ' ')}</span>
              </div>
              <div className="steps">
                <span>01 Review</span>
                <span>02 Call</span>
                <span>03 Verify</span>
                <span>04 Confirm</span>
              </div>
              <article>
                <h3>Call authorization</h3>
                <dl>
                  <dt>Recipient</dt>
                  <dd>{job.phone || 'Synthetic customer — no dial'}</dd>
                  <dt>Exact task</dt>
                  <dd>{job.purpose}</dd>
                  <dt>Boundaries</dt>
                  <dd>
                    Availability only. No booking, payment, private information,
                    or repeated dialing.
                  </dd>
                  <dt>Approval expires</dt>
                  <dd>{new Date(job.expires).toLocaleString()}</dd>
                </dl>
                <div className="actions">
                  {job.state === 'awaiting_approval' && (
                    <>
                      <Button disabled={busy} onClick={() => act('approve')}>
                        Approve this exact plan
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => act('cancel')}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                  {job.state === 'approved' && (
                    <Button disabled={busy} onClick={() => act('run')}>
                      {job.mode === 'practice'
                        ? 'Run synthetic conversation'
                        : 'Place authorized call'}
                    </Button>
                  )}
                  {['running', 'status_unresolved'].includes(job.state) && (
                    <Button disabled={busy} onClick={() => act('poll')}>
                      Check existing call
                    </Button>
                  )}
                </div>
                {job.runId && <p className="quiet">Reference: {job.runId}</p>}
              </article>
              {job.result && (
                <article className="evidence">
                  <h3>
                    Evidence receipt · {job.result.outcome.replaceAll('_', ' ')}
                  </h3>
                  <blockquote>
                    {job.result.evidence || 'No reliable evidence returned.'}
                  </blockquote>
                  <p>
                    <strong>Proposed window:</strong>{' '}
                    {job.result.window || 'Needs clarification'}
                  </p>
                  <p className="quiet">
                    A completed call is not a completed pickup.
                  </p>
                  {job.state === 'needs_review' &&
                    job.result.outcome === 'confirmed_window' && (
                      <Button disabled={busy} onClick={() => act('confirm')}>
                        Accept proposed window
                      </Button>
                    )}
                </article>
              )}
              <article>
                <div className="sectiontitle">
                  <h3>Audit trail</h3>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(
                        new Blob([JSON.stringify(job, null, 2)], {
                          type: 'application/json',
                        }),
                      );
                      a.download = `pickupproof-${job.id}.json`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Export receipt
                  </Button>
                </div>
                {job.audit.map((a, i) => (
                  <div className="audit" key={i}>
                    <time>{new Date(a.at).toLocaleTimeString()}</time>
                    <span>{a.action.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </article>
            </>
          ) : (
            <div className="welcome">
              <p className="eyebrow">READY WHEN YOU ARE</p>
              <h2>Recover a missed pickup</h2>
              <p>
                Create a practice case to walk through approval, a synthetic
                conversation, and evidence review.
              </p>
              <p>
                No live call is possible until service and operator credentials
                are configured.
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => act('refresh')}
          >
            Refresh queue
          </Button>
        </section>
      </div>
      <footer>
        PickupProof · CALL-E hackathon build · Synthetic results are labeled.
      </footer>
    </main>
  );
}

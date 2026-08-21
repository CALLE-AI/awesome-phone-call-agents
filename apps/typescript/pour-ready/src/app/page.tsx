'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type CallSnapshot,
  type ContactInput,
  type HumanDecision,
  type PourPlan,
  type Region,
  ROLE_LABELS,
  ROLES,
  maskPhone,
} from '@/lib/domain';
import {
  completedDemoCalls,
  previewQuestions,
  queuedDemoCalls,
} from '@/lib/demo';
import { reconcile } from '@/lib/reconcile';

type Stage = 'setup' | 'preview' | 'board';
type Mode = 'dry' | 'live';

const STORAGE_KEY = 'pour-ready-run-v1';

const DEFAULT_PLAN: PourPlan = {
  companyName: 'Northstar Concrete',
  projectName: 'Harbour Point — Slab B',
  location: 'Tuas South, Singapore',
  scheduledDate: '2026-09-03',
  scheduledTime: '06:30',
  volumeM3: '85',
  mixReference: 'C40 / P-217',
  region: 'SG',
};

const DEFAULT_CONTACTS: ContactInput[] = [
  { role: 'site_supervisor', name: 'Daniel Tan', phone: '' },
  { role: 'ready_mix_dispatch', name: 'Mei Lin', phone: '' },
  { role: 'pump_operator', name: 'Arun Kumar', phone: '' },
  { role: 'testing_coordinator', name: 'Sofia Rahman', phone: '' },
];

const TERMINAL = new Set(['completed', 'failed', 'incomplete']);

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function statusLabel(status: CallSnapshot['status']) {
  return status === 'calling'
    ? 'CALLING'
    : status === 'incomplete'
      ? 'NEEDS REVIEW'
      : status.toUpperCase();
}

function requiredPlanReady(plan: PourPlan) {
  return Object.values(plan).every((value) => value.trim().length > 0);
}

export default function Home() {
  const [stage, setStage] = useState<Stage>('setup');
  const [mode, setMode] = useState<Mode>('dry');
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const [authorized, setAuthorized] = useState(false);
  const [calls, setCalls] = useState<CallSnapshot[]>([]);
  const [runId, setRunId] = useState('');
  const [decision, setDecision] = useState<HumanDecision | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const reconciliation = useMemo(() => reconcile(calls), [calls]);

  useEffect(() => {
    const recovery = window.setTimeout(() => {
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        const recovered = JSON.parse(stored) as {
          plan?: PourPlan;
          calls?: CallSnapshot[];
          runId?: string;
          decision?: HumanDecision | null;
        };
        if (recovered.plan) setPlan(recovered.plan);
        if (recovered.calls?.length) {
          setCalls(recovered.calls);
          setStage('board');
        }
        if (recovered.runId) setRunId(recovered.runId);
        if (recovered.decision) setDecision(recovered.decision);
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(recovery);
  }, []);

  useEffect(() => {
    if (!calls.length) return;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ plan, calls, runId, decision }),
    );
  }, [calls, decision, plan, runId]);

  function updatePlan(field: keyof PourPlan, value: string) {
    setPlan((current) => ({ ...current, [field]: value }));
  }

  function updateContact(
    index: number,
    field: 'name' | 'phone',
    value: string,
  ) {
    setContacts((current) =>
      current.map((contact, itemIndex) =>
        itemIndex === index ? { ...contact, [field]: value } : contact,
      ),
    );
  }

  function showPreview() {
    setError('');
    if (!requiredPlanReady(plan)) {
      setError('Complete every pour-plan field before previewing calls.');
      return;
    }
    if (contacts.some((contact) => !contact.name.trim())) {
      setError('Every required role needs a contact name.');
      return;
    }
    setStage('preview');
  }

  async function runDryDemo() {
    const queued = queuedDemoCalls();
    const completed = completedDemoCalls(plan);
    setCalls(queued);
    setStage('board');
    for (const role of ROLES) {
      await wait(260);
      setCalls((current) =>
        current.map((call) =>
          call.role === role ? { ...call, status: 'calling' } : call,
        ),
      );
      await wait(360);
      const finalCall = completed.find((call) => call.role === role);
      if (finalCall) {
        setCalls((current) =>
          current.map((call) => (call.role === role ? finalCall : call)),
        );
      }
    }
  }

  async function pollLiveCalls(id: string, initial: CallSnapshot[]) {
    let current = initial;
    while (current.some((call) => !TERMINAL.has(call.status))) {
      await wait(2500);
      current = await Promise.all(
        current.map(async (call) => {
          if (!call.callId || TERMINAL.has(call.status)) return call;
          try {
            const response = await fetch(
              '/api/calls/' +
                encodeURIComponent(call.callId) +
                '?runId=' +
                encodeURIComponent(id),
              { cache: 'no-store' },
            );
            if (!response.ok) return call;
            const data = (await response.json()) as { call: CallSnapshot };
            return data.call;
          } catch {
            return call;
          }
        }),
      );
      setCalls(current);
    }
  }

  async function runLive() {
    if (!authorized) {
      setError('Confirm ownership or authorization for all four numbers.');
      return;
    }
    if (contacts.some((contact) => !contact.phone.trim())) {
      setError('Live mode requires an E.164 phone number for every role.');
      return;
    }

    const id = crypto.randomUUID();
    setRunId(id);
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: id,
        liveConfirmed: true,
        plan,
        contacts,
      }),
    });
    const data = (await response.json()) as {
      calls?: CallSnapshot[];
      error?: string;
    };
    if (!response.ok || !data.calls) {
      throw new Error(data.error || 'The live run could not be started.');
    }
    setCalls(data.calls);
    setStage('board');
    await pollLiveCalls(id, data.calls);
  }

  async function beginRun() {
    setError('');
    setDecision(null);
    setRunning(true);
    try {
      if (mode === 'dry') {
        setRunId('demo-' + Date.now());
        await runDryDemo();
      } else {
        await runLive();
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The run could not be started.',
      );
    } finally {
      setRunning(false);
    }
  }

  function chooseDecision(choice: HumanDecision['choice']) {
    setDecision({ choice, at: new Date().toISOString() });
  }

  function resetDemo() {
    sessionStorage.removeItem(STORAGE_KEY);
    setStage('setup');
    setMode('dry');
    setPlan(DEFAULT_PLAN);
    setContacts(DEFAULT_CONTACTS);
    setAuthorized(false);
    setCalls([]);
    setRunId('');
    setDecision(null);
    setRunning(false);
    setError('');
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="PourReady home">
          <span className="brand-mark">PR</span>
          <span>
            <strong>POURREADY</strong>
            <small>PRE-POUR COORDINATION GATE</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="system-dot" />
          SYSTEM READY
          <span className="divider" />
          AU / SG
        </div>
      </header>

      <section className="hero shell">
        <div>
          <p className="eyebrow">CONCRETE OPERATIONS · CALL-E POWERED</p>
          <h1>Before the trucks roll,<br />align every voice.</h1>
          <p className="hero-copy">
            PourReady calls four critical parties, captures their explicit
            commitments, and surfaces contradictions before an expensive pour
            starts moving.
          </p>
        </div>
        <aside className="scenario-stamp">
          <span>GOLDEN DEMO</span>
          <strong>06:30</strong>
          <small>PLANNED POUR · SINGAPORE</small>
        </aside>
      </section>

      <nav className="workflow shell" aria-label="Workflow progress">
        {[
          ['setup', '01', 'Pour setup'],
          ['preview', '02', 'Preview & authorize'],
          ['board', '03', 'Readiness board'],
        ].map(([key, number, label]) => (
          <div
            className={
              'workflow-step ' +
              (stage === key
                ? 'active'
                : ['setup', 'preview', 'board'].indexOf(stage) >
                    ['setup', 'preview', 'board'].indexOf(key)
                  ? 'done'
                  : '')
            }
            key={key}
          >
            <span>{number}</span>
            {label}
          </div>
        ))}
      </nav>

      {stage === 'setup' && (
        <section className="workspace shell">
          <div className="section-heading">
            <div>
              <p className="eyebrow">STEP 01</p>
              <h2>Define the shared plan</h2>
            </div>
            <p>One fictional pour. Four real coordination roles.</p>
          </div>

          <div className="setup-grid">
            <div className="panel">
              <div className="panel-title">
                <span>POUR PLAN</span>
                <em>FICTIONAL SCENARIO</em>
              </div>
              <div className="form-grid">
                <label>
                  Company
                  <input
                    value={plan.companyName}
                    onChange={(event) =>
                      updatePlan('companyName', event.target.value)
                    }
                  />
                </label>
                <label>
                  Project
                  <input
                    value={plan.projectName}
                    onChange={(event) =>
                      updatePlan('projectName', event.target.value)
                    }
                  />
                </label>
                <label className="wide">
                  Location
                  <input
                    value={plan.location}
                    onChange={(event) =>
                      updatePlan('location', event.target.value)
                    }
                  />
                </label>
                <label>
                  Pour date
                  <input
                    type="date"
                    value={plan.scheduledDate}
                    onChange={(event) =>
                      updatePlan('scheduledDate', event.target.value)
                    }
                  />
                </label>
                <label>
                  Planned time
                  <input
                    type="time"
                    value={plan.scheduledTime}
                    onChange={(event) =>
                      updatePlan('scheduledTime', event.target.value)
                    }
                  />
                </label>
                <label>
                  Volume
                  <span className="input-suffix">
                    <input
                      value={plan.volumeM3}
                      onChange={(event) =>
                        updatePlan('volumeM3', event.target.value)
                      }
                    />
                    <b>m³</b>
                  </span>
                </label>
                <label>
                  Mix reference
                  <input
                    value={plan.mixReference}
                    onChange={(event) =>
                      updatePlan('mixReference', event.target.value)
                    }
                  />
                </label>
                <label className="wide">
                  Operating region
                  <select
                    value={plan.region}
                    onChange={(event) =>
                      updatePlan('region', event.target.value as Region)
                    }
                  >
                    <option value="SG">Singapore · en-SG · +65</option>
                    <option value="AU">Australia · en-AU · +61</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="panel contacts-panel">
              <div className="panel-title">
                <span>REQUIRED CONTACTS</span>
                <em>4 / 4 ROLES</em>
              </div>
              <div className="contact-list">
                {contacts.map((contact, index) => (
                  <div className="contact-row" key={contact.role}>
                    <span className="role-number">0{index + 1}</span>
                    <div className="contact-fields">
                      <strong>{ROLE_LABELS[contact.role]}</strong>
                      <div>
                        <label>
                          <span className="sr-only">Contact name</span>
                          <input
                            value={contact.name}
                            onChange={(event) =>
                              updateContact(index, 'name', event.target.value)
                            }
                            placeholder="Contact name"
                          />
                        </label>
                        <label>
                          <span className="sr-only">E.164 phone number</span>
                          <input
                            value={contact.phone}
                            onChange={(event) =>
                              updateContact(index, 'phone', event.target.value)
                            }
                            placeholder={
                              plan.region === 'SG'
                                ? '+6581234567 (live only)'
                                : '+61412345678 (live only)'
                            }
                            inputMode="tel"
                            autoComplete="off"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="privacy-note">
                Phone numbers are sent only when you authorize a live run. They
                are never written to session storage.
              </p>
            </div>
          </div>

          {error && <p className="error-banner">{error}</p>}
          <div className="action-row">
            <span>Dry-run needs no API key and places no calls.</span>
            <button className="button primary" onClick={showPreview}>
              PREVIEW CALL PLAN <span>→</span>
            </button>
          </div>
        </section>
      )}

      {stage === 'preview' && (
        <section className="workspace shell">
          <div className="section-heading">
            <div>
              <p className="eyebrow">STEP 02</p>
              <h2>Inspect every call before dispatch</h2>
            </div>
            <p>No hidden questions. No authority to change the plan.</p>
          </div>

          <div className="mode-switch" role="group" aria-label="Run mode">
            <button
              className={mode === 'dry' ? 'selected' : ''}
              onClick={() => {
                setMode('dry');
                setAuthorized(false);
              }}
            >
              <strong>DRY-RUN</strong>
              <span>Fixture data · no calls · no credentials</span>
            </button>
            <button
              className={mode === 'live' ? 'selected danger' : ''}
              onClick={() => setMode('live')}
            >
              <strong>LIVE CALLS</strong>
              <span>Real external side effects · explicit consent</span>
            </button>
          </div>

          <div className="preview-summary">
            <span>{plan.scheduledDate}</span>
            <strong>{plan.scheduledTime}</strong>
            <span>{plan.volumeM3} m³</span>
            <span>{plan.mixReference}</span>
            <span>{plan.region}</span>
          </div>

          <div className="preview-grid">
            {contacts.map((contact, index) => (
              <article className="call-preview" key={contact.role}>
                <header>
                  <span>CALL 0{index + 1}</span>
                  <em>{mode === 'dry' ? 'SIMULATED' : maskPhone(contact.phone)}</em>
                </header>
                <h3>{ROLE_LABELS[contact.role]}</h3>
                <p>{contact.name}</p>
                <ol>
                  {previewQuestions(contact.role).map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ol>
              </article>
            ))}
          </div>

          <div className="boundary">
            <span className="boundary-icon">!</span>
            <div>
              <strong>CALL-E reports facts. It does not control the pour.</strong>
              <p>
                The assistant introduces itself, verifies the contact, and never
                changes orders, cancels work, approves safety or engineering,
                makes financial commitments, or issues a go/no-go decision.
              </p>
            </div>
          </div>

          {mode === 'live' && (
            <label className="authorization">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(event) => setAuthorized(event.target.checked)}
              />
              <span>
                <strong>I authorize these four live calls.</strong>
                I own or have permission to call every E.164 number above. I
                understand calls cannot be canceled from this app once submitted.
              </span>
            </label>
          )}

          {error && <p className="error-banner">{error}</p>}
          <div className="action-row">
            <button className="button ghost" onClick={() => setStage('setup')}>
              ← EDIT SETUP
            </button>
            <button
              className={'button ' + (mode === 'live' ? 'live' : 'primary')}
              onClick={beginRun}
              disabled={running}
            >
              {running
                ? 'STARTING…'
                : mode === 'dry'
                  ? 'RUN GOLDEN DEMO →'
                  : 'AUTHORIZE 4 LIVE CALLS →'}
            </button>
          </div>
        </section>
      )}

      {stage === 'board' && (
        <section className="workspace shell">
          <div className="board-heading">
            <div>
              <p className="eyebrow">STEP 03 · READINESS BOARD</p>
              <h2>{plan.projectName}</h2>
              <p>
                {plan.location} · {plan.scheduledDate} at {plan.scheduledTime} ·{' '}
                {plan.volumeM3} m³
              </p>
            </div>
            <button className="button ghost compact" onClick={resetDemo}>
              RESET DEMO
            </button>
          </div>

          <div className={'verdict ' + reconciliation.state}>
            <div className="verdict-code">
              {reconciliation.state === 'aligned'
                ? 'ALIGNED'
                : reconciliation.state === 'conflict'
                  ? 'CONFLICT'
                  : 'INCOMPLETE'}
            </div>
            <div>
              <p className="eyebrow">COORDINATION RESULT</p>
              <h2>{reconciliation.headline}</h2>
              <p>{reconciliation.detail}</p>
            </div>
            <div className="verdict-time">
              <span>PLANNED</span>
              <strong>{plan.scheduledTime}</strong>
            </div>
          </div>

          {reconciliation.conflicts.length > 0 && (
            <div className="conflict-strip">
              <span>!</span>
              <div>
                <strong>CONFLICT EXPLAINED</strong>
                {reconciliation.conflicts.map((conflict) => (
                  <p key={conflict}>{conflict}</p>
                ))}
              </div>
            </div>
          )}

          <div className="readiness-grid">
            {calls.map((call, index) => (
              <article className={'readiness-card ' + call.status} key={call.role}>
                <header>
                  <span>0{index + 1} · {ROLE_LABELS[call.role]}</span>
                  <em>{statusLabel(call.status)}</em>
                </header>
                <div className="call-identity">
                  <strong>{call.maskedPhone}</strong>
                  <span>{call.callId || 'Awaiting call id'}</span>
                </div>
                {call.result ? (
                  <>
                    <div className="fact-grid">
                      <div>
                        <span>COMMITMENT</span>
                        <strong>{call.result.commitment}</strong>
                      </div>
                      <div>
                        <span>REPORTED TIME</span>
                        <strong>{call.result.reported_time || 'Unknown'}</strong>
                      </div>
                      <div>
                        <span>SCHEDULE</span>
                        <strong>{call.result.schedule_alignment}</strong>
                      </div>
                      <div>
                        <span>CONFIDENCE</span>
                        <strong>
                          {call.completionConfidence?.label || 'Unknown'}
                        </strong>
                      </div>
                    </div>
                    {call.result.blocker && (
                      <p className="blocker">{call.result.blocker}</p>
                    )}
                    <p className="evidence-summary">
                      {call.result.evidence_summary}
                    </p>
                    <details>
                      <summary>OPEN SUPPORTING EVIDENCE</summary>
                      {call.evidence.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                      {call.transcriptTurns.map((turn, turnIndex) => (
                        <blockquote key={turnIndex}>
                          <span>{turn.speaker}</span>
                          {turn.text}
                        </blockquote>
                      ))}
                    </details>
                  </>
                ) : (
                  <p className="awaiting">
                    {call.status === 'failed'
                      ? 'Call failed. No automatic retry was made.'
                      : 'Waiting for explicit, structured confirmation…'}
                  </p>
                )}
              </article>
            ))}
          </div>

          <section className="decision-panel">
            <div>
              <p className="eyebrow">HUMAN CONTROL POINT</p>
              <h2>Record the supervisor&apos;s decision</h2>
              <p>
                PourReady never decides whether work proceeds. Review the
                evidence, resolve conflicts through your normal safety process,
                then record the human decision.
              </p>
            </div>
            <div className="decision-actions">
              <button
                className={
                  'decision-button proceed ' +
                  (decision?.choice === 'proceed' ? 'chosen' : '')
                }
                onClick={() => chooseDecision('proceed')}
              >
                <span>✓</span>
                <strong>PROCEED</strong>
                Human authorizes
              </button>
              <button
                className={
                  'decision-button hold ' +
                  (decision?.choice === 'hold' ? 'chosen' : '')
                }
                onClick={() => chooseDecision('hold')}
              >
                <span>Ⅱ</span>
                <strong>HOLD</strong>
                Resolve first
              </button>
            </div>
            {decision && (
              <div className="audit-event">
                AUDIT EVENT · {decision.choice.toUpperCase()} ·{' '}
                {new Date(decision.at).toLocaleString('en-SG')}
              </div>
            )}
          </section>

          <p className="safety-footer">
            Reported facts only. PourReady does not replace supervisors,
            engineers, inspectors, SWMS processes, testing requirements, or
            safety approvals. Live calls continue at CALL-E after submission and
            cannot be canceled from this client.
          </p>
          {error && <p className="error-banner">{error}</p>}
        </section>
      )}

      <footer>
        <span>POURREADY / CALL-E HACKATHON BUILD</span>
        <span>NO AUTOMATIC GO / NO-GO</span>
      </footer>
    </main>
  );
}

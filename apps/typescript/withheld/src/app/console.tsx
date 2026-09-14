'use client';

import { useState, useTransition } from 'react';
import { runScenario } from './actions';
import { SCENARIOS, type ClientErrand, type RunResult } from './scenarios';
import { formatWindow } from '@/core/script';
import type { LegResult, LegStatus, Turn } from '@/core/types';

const STATUS_TONE: Record<LegStatus, string> = {
  errand_complete: 'good',
  window_agreed: 'good',
  window_unconfirmed: 'warn',
  callback_refused_by_callee: 'warn',
  number_demanded: 'warn',
  outcome_unknown: 'bad',
  no_answer: 'neutral',
  not_terminal: 'neutral',
};

const STATUS_LABEL: Record<LegStatus, string> = {
  errand_complete: 'errand complete',
  window_agreed: 'window agreed',
  window_unconfirmed: 'window unconfirmed',
  callback_refused_by_callee: 'no time offered',
  number_demanded: 'number demanded',
  outcome_unknown: 'outcome unknown',
  no_answer: 'no answer',
  not_terminal: 'not finished',
};

/**
 * Pull out the exchange that decides the leg — the moment a callback is offered
 * or a number is asked for, and what the agent said next. This is the whole
 * product in four lines, so it gets shown before anything else.
 */
function gateExchange(turns: Turn[]): { turns: Turn[]; found: boolean } {
  const trigger = turns.findIndex(
    (t) =>
      t.speaker === 'callee' &&
      /(call|ring|phone|get)\s+(you|him|her|them)\s+back|call\s+you|number (I|we) can|best number|reach (you|her|him|them)( on)?|give me (a|your|the) number|what(?:'s| is) (?:your|the) number/i.test(
        t.text,
      ),
  );

  if (trigger === -1) {
    return { turns: turns.slice(0, 4), found: false };
  }

  return {
    turns: turns.slice(trigger, Math.min(trigger + 4, turns.length)),
    found: true,
  };
}

function Exchange({ turns }: { turns: Turn[] }) {
  return (
    <ul className="exchange">
      {turns.map((t, i) => (
        <li key={i}>
          <span className={`who ${t.speaker}`}>
            {t.speaker === 'caller'
              ? 'agent'
              : t.speaker === 'callee'
                ? 'clinic'
                : '???'}
          </span>
          <span>{t.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Leg({ result, turns }: { result: LegResult; turns: Turn[] }) {
  const gate = gateExchange(turns);
  const broken = result.number_disclosed;
  const held = result.number_requested_by_callee && !broken;

  return (
    <article className="leg">
      <header className="leg-head">
        <span className="leg-n">Leg {result.leg}</span>
        <span className={`status ${STATUS_TONE[result.status]}`}>
          {STATUS_LABEL[result.status]}
        </span>
        <span className="ref">{result.transcript_ref}</span>
      </header>

      <div className="leg-body">
        {turns.length > 0 && (
          <div
            className={`gate ${broken ? 'broken' : held ? 'held' : ''}`}
          >
            <div className="gate-title">
              {gate.found
                ? broken
                  ? 'The number left the building'
                  : held
                    ? 'They asked for a number'
                    : 'They offered to call back'
                : 'How the call opened'}
            </div>

            <Exchange turns={gate.turns} />

            {gate.found && (
              <p className="gate-verdict">
                {broken ? (
                  <>
                    <strong>The agent said it.</strong> This outranks every
                    other outcome on the call, including a booking, and stops
                    the chain.
                  </>
                ) : held ? (
                  <>
                    <strong>The agent had nothing to give.</strong> The number
                    was never put in the script, so there was none in reach to
                    surrender under pressure.
                  </>
                ) : result.agreed_window.start ? (
                  <>
                    <strong>The agent declined and asked for a window.</strong>{' '}
                    The callback became an outbound call.
                  </>
                ) : (
                  <>
                    <strong>The agent declined the callback.</strong> No time
                    was named in reply, so nothing is treated as agreed.
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {result.agreed_window.start && result.agreed_window.end && (
          <>
            <h3>Window taken</h3>
            <p className="a">
              {formatWindow(result.agreed_window.start, result.agreed_window.end)}
            </p>
            {result.agreed_window.supporting_turn && (
              <p className="quote">“{result.agreed_window.supporting_turn}”</p>
            )}
          </>
        )}

        {result.answers.length > 0 && (
          <>
            <h3>Answers, each bound to a turn</h3>
            <ul className="answers">
              {result.answers.map((a) => (
                <li key={a.question_id}>
                  <div className="q">{a.question}</div>
                  {a.answer === null ? (
                    <div
                      className={`a ${a.provider_claimed_unsupported ? 'disputed' : 'unanswered'}`}
                    >
                      {a.provider_claimed_unsupported
                        ? 'Not answered — CALL-E returned an answer, and no turn supports it.'
                        : 'Not answered.'}
                    </div>
                  ) : (
                    <>
                      <div className="a">{a.answer}</div>
                      <div className="quote">“{a.supporting_turn}”</div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>Disclosure ledger</h3>
        <div className="ledger">
          <div>
            <span className="l">Number disclosed</span>
            <span className={`v ${broken ? 'bad' : 'good'}`}>
              {broken ? 'YES' : 'no'}
            </span>
          </div>
          <div>
            <span className="l">Number asked for</span>
            <span className={`v ${result.number_requested_by_callee ? 'warn' : ''}`}>
              {result.number_requested_by_callee ? 'yes' : 'no'}
            </span>
          </div>
          <div>
            <span className="l">Callback offered</span>
            <span className="v">
              {result.callback_requested_by_callee ? 'yes' : 'no'}
            </span>
          </div>
          <div>
            <span className="l">Facts stated</span>
            <span className="v">{result.disclosed_about_person.length}</span>
          </div>
        </div>

        {result.disclosed_about_person.length > 0 && (
          <>
            <h3>Said about them, and nothing else</h3>
            <ul className="budget">
              {result.disclosed_about_person.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </>
        )}

        {result.outside_may_say_findings.length > 0 && (
          <ul className="violations">
            {result.outside_may_say_findings.map((v, i) => (
              <li key={i}>
                <span className="masked">
                  {v.kind} · {v.masked}
                </span>{' '}
                — {v.note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export default function Console({ errand }: { errand: ClientErrand }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [active, setActive] = useState('happy');
  const [pending, start] = useTransition();

  function run(id: string) {
    setActive(id);
    start(async () => {
      setResult(await runScenario(id));
    });
  }

  const state = result?.state;
  const last = state?.legs.at(-1);

  return (
    <main>
      <header className="masthead">
        <p className="wordmark">Withheld</p>
        <h1 className="thesis">
          A callback is a door you cannot open. So <em>never accept one.</em>
        </h1>
        <p className="subthesis">
          Every errand ends the same way: <em>we&rsquo;ll call you back.</em> For
          someone who cannot answer a phone, that sentence ends the errand.
          Withheld declines the callback, takes a time window instead, and rings
          back itself — so the number is never given out and they never have to
          pick up.
        </p>
      </header>

      <div className="columns">
        <aside>
          <section className="panel">
            <h2>Errand</h2>
            <div className="kv">
              <span>On behalf of</span>
              <span>{errand.person.name}</span>
            </div>
            <div className="kv">
              <span>Calling</span>
              <span>{errand.callee.name}</span>
            </div>

            <div className="withheld-row">
              <span className="label">Withheld</span>
              <span className="value">{errand.person.phone_masked}</span>
              <span className="note">
                The real number never reaches this page &mdash; not on screen and
                not in the page source. It stays server-side so the app can prove
                it was never said: blocked at script generation, then re-checked
                against every transcript afterwards.
              </span>
            </div>

            <h3>They may say only this</h3>
            <ul className="budget">
              {errand.may_say.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>

            <h3>They may agree only to this</h3>
            <ul className="windows">
              {errand.acceptable_windows.map((w) => (
                <li key={w.start}>{formatWindow(w.start, w.end)}</li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Not sent to CALL-E</h2>
            <p className="subthesis" style={{ fontSize: 13 }}>
              {errand.reason}
            </p>
            <p className="quote" style={{ marginTop: 10 }}>
              Why someone cannot use a phone is the most sensitive field in the
              file, and the clinic does not need it to book an appointment. It
              never leaves this process.
            </p>
          </section>
        </aside>

        <section>
          <div className="controls">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => run(s.id)}
                aria-pressed={active === s.id}
                disabled={pending}
                className={s.id === 'leaked' ? 'danger' : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>

          {result && (
            <p
              className="subthesis"
              style={{ marginBottom: 18, fontSize: 13.5 }}
            >
              {result.scenario.blurb}
            </p>
          )}

          {!result && !pending && (
            <p className="empty">
              Pick what the clinic does. Every run replays a recorded call — no
              credentials, no calls placed.
            </p>
          )}

          {pending && <p className="empty">Running the errand…</p>}

          {state?.legs.map((leg) => (
            <Leg
              key={leg.leg}
              result={leg}
              turns={
                result?.transcripts.find((t) => t.leg === leg.leg)?.turns ?? []
              }
            />
          ))}

          {state && state.scheduled.length > 0 && (
            <div className="scheduled">
              <div className="gate-title">
                Scheduled — because they named a time
              </div>
              {state.scheduled.map((s) => (
                <div key={s.leg}>
                  <p style={{ margin: '0 0 6px' }}>
                    Leg {s.leg}, inside {formatWindow(s.not_before, s.not_after)}
                  </p>
                  {s.supporting_turn && (
                    <p className="quote">“{s.supporting_turn}”</p>
                  )}
                </div>
              ))}
              <p className="gate-verdict">
                Withheld proposes the call and stops. It runs no timer and no
                cron — an app that decides both whether and when to dial is an
                app that can ring a stranger at 3am because of a parsing bug.
              </p>
            </div>
          )}

          {state?.halted_reason && (
            <div className="halted">
              <div className="gate-title">Handed back to a person</div>
              {state.halted_reason}
            </div>
          )}

          {state && !state.halted_reason && last?.status === 'errand_complete' && (
            <div className="complete">
              <div className="gate-title">Errand complete</div>
              Booked across {state.legs.length} calls.{' '}
              {errand.person.name.split(' ')[0]} answered none of them, and the
              clinic never had a number to ring.
            </div>
          )}
        </section>
      </div>

      <footer className="foot">
        Fixture replay is the default and is what you are seeing: no API key, no
        calls placed. Real calls go through <code>@call-e/calle</code> and are
        reachable only via <code>npm run withheld -- run --real</code>. Nothing
        here trusts CALL-E&rsquo;s own <code>taskCompleted</code> or{' '}
        <code>completionConfidence</code>; every answer above is re-derived from
        the transcript and shown with the turn that supports it.
      </footer>
    </main>
  );
}

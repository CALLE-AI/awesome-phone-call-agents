'use client';

import { useEffect, useState, useTransition } from 'react';
import { runScenario } from './actions';
import { SCENARIOS, type ClientErrand, type RunResult } from './scenarios';
import { formatWindow } from '@/core/script';
import type { LegResult, LegStatus, Turn } from '@/core/types';

const TONE: Record<LegStatus, string> = {
  errand_complete: 'good',
  window_agreed: 'good',
  window_unconfirmed: 'warn',
  callback_refused_by_callee: 'warn',
  number_demanded: 'warn',
  outcome_unknown: 'bad',
  no_answer: 'flat',
  not_terminal: 'flat',
};

const LABEL: Record<LegStatus, string> = {
  errand_complete: 'booked',
  window_agreed: 'window agreed',
  window_unconfirmed: 'window unclear',
  callback_refused_by_callee: 'no time offered',
  number_demanded: 'number demanded',
  outcome_unknown: 'outcome unknown',
  no_answer: 'no answer',
  not_terminal: 'unfinished',
};

const WHO: Record<Turn['speaker'], string> = {
  caller: 'agent',
  callee: 'clinic',
  unknown: '??',
};

/**
 * The exchange that decides the leg: the moment a callback is offered or a
 * number asked for, plus the agent's reply. That is the product, so it leads.
 */
function gateExchange(turns: Turn[]): { turns: Turn[]; found: boolean } {
  const at = turns.findIndex(
    (t) =>
      t.speaker === 'callee' &&
      /(call|ring|phone|get)\s+(you|him|her|them)\s+back|call\s+you|number (I|we) can|best number|reach (you|her|him|them)( on)?|give me (a|your|the) number|what(?:'s| is) (?:your|the) number/i.test(
        t.text,
      ),
  );
  if (at === -1) return { turns: turns.slice(0, 4), found: false };
  return { turns: turns.slice(at, Math.min(at + 4, turns.length)), found: true };
}

function Exchange({ turns }: { turns: Turn[] }) {
  return (
    <ul className="exchange">
      {turns.map((t, i) => (
        <li key={i}>
          <span className={`who ${t.speaker}`}>{WHO[t.speaker]}</span>
          <span className="said">{t.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Step({
  glyph,
  title,
  tag,
  tone,
  children,
}: {
  glyph: string;
  title: string;
  tag?: { text: string; tone: string };
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={`step ${tone ?? ''}`}>
      <span className="dot" aria-hidden="true">
        {glyph}
      </span>
      <div className="card">
        <div className="card-head">
          <h3>{title}</h3>
          {tag && <span className={`pill ${tag.tone}`}>{tag.text}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

function gateTitle(r: LegResult, found: boolean) {
  if (r.number_disclosed) return 'The number got out';
  if (r.number_requested_by_callee) return 'They asked for a number';
  if (found) return 'They offered to call back';
  return 'How it opened';
}

function gateVerdict(r: LegResult) {
  if (r.number_disclosed)
    return (
      <>
        <b>The agent said it.</b> Outranks the booking. Chain stops.
      </>
    );
  if (r.number_requested_by_callee)
    return (
      <>
        <b>Nothing to hand over.</b> The number was never in the script.
      </>
    );
  if (r.agreed_window.start)
    return (
      <>
        <b>Declined. Took a window instead.</b> The callback became an outbound
        call.
      </>
    );
  return (
    <>
      <b>Declined.</b> No time named, so nothing counts as agreed.
    </>
  );
}

function LegSteps({
  r,
  turns,
  scheduled,
}: {
  r: LegResult;
  turns: Turn[];
  scheduled?: {
    not_before: string;
    not_after: string;
    supporting_turn?: string | null;
  };
}) {
  const gate = gateExchange(turns);
  const leaked = r.number_disclosed;

  return (
    <>
      <Step
        glyph={String(r.leg)}
        title={`Call ${r.leg} placed`}
        tag={{ text: LABEL[r.status], tone: TONE[r.status] }}
        tone="call"
      >
        <p className="ref">{r.transcript_ref}</p>
      </Step>

      {turns.length > 0 && (
        <Step
          glyph="&#10077;"
          title={gateTitle(r, gate.found)}
          tone={leaked ? 'bad' : r.number_requested_by_callee ? 'held' : undefined}
        >
          <Exchange turns={gate.turns} />
          {gate.found && <p className="verdict">{gateVerdict(r)}</p>}
        </Step>
      )}

      {r.agreed_window.start && r.agreed_window.end && (
        <Step glyph="&#9719;" title="Window taken" tone="good">
          <p className="big">
            {formatWindow(r.agreed_window.start, r.agreed_window.end)}
          </p>
          {r.agreed_window.supporting_turn && (
            <p className="quote">&ldquo;{r.agreed_window.supporting_turn}&rdquo;</p>
          )}
        </Step>
      )}

      {r.answers.length > 0 && (
        <Step glyph="&#10003;" title="Answers, each tied to a turn">
          <ul className="answers">
            {r.answers.map((a) => (
              <li key={a.question_id}>
                <div className="q">{a.question}</div>
                {a.answer === null ? (
                  <div
                    className={`a ${a.provider_claimed_unsupported ? 'disputed' : 'none'}`}
                  >
                    {a.provider_claimed_unsupported
                      ? 'Unanswered — CALL-E claimed one, no turn backs it.'
                      : 'Unanswered.'}
                  </div>
                ) : (
                  <>
                    <div className="a">{a.answer}</div>
                    <div className="quote">&ldquo;{a.supporting_turn}&rdquo;</div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Step>
      )}

      <Step glyph="&#9930;" title="Ledger" tone={leaked ? 'bad' : undefined}>
        <div className="ledger">
          <span className={`chip ${leaked ? 'bad' : 'good'}`}>
            number out <b>{leaked ? 'YES' : 'no'}</b>
          </span>
          <span className={`chip ${r.number_requested_by_callee ? 'warn' : ''}`}>
            asked for it <b>{r.number_requested_by_callee ? 'yes' : 'no'}</b>
          </span>
          <span className="chip">
            callback offered{' '}
            <b>{r.callback_requested_by_callee ? 'yes' : 'no'}</b>
          </span>
        </div>

        {r.disclosed_about_person.length > 0 && (
          <>
            <p className="lede">Said about them, and nothing else</p>
            <ul className="chips">
              {r.disclosed_about_person.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </>
        )}

        {r.outside_may_say_findings.length > 0 && (
          <ul className="findings">
            {r.outside_may_say_findings.map((v, i) => (
              <li key={i}>
                <code>
                  {v.kind} &middot; {v.masked}
                </code>{' '}
                {v.note}
              </li>
            ))}
          </ul>
        )}
      </Step>

      {scheduled && (
        <Step glyph="&#8631;" title={`Call ${r.leg + 1} queued`} tone="next">
          <p className="big">
            {formatWindow(scheduled.not_before, scheduled.not_after)}
          </p>
          <p className="verdict">
            Proposed, not scheduled. No timer, no cron &mdash; nothing here dials
            on its own.
          </p>
        </Step>
      )}
    </>
  );
}

const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';

/**
 * The at-a-glance state, kept in view while the timeline scrolls. The timeline
 * says what happened; this says whether the one thing that matters still holds.
 */
function Rail({
  errand,
  state,
}: {
  errand: ClientErrand;
  state?: RunResult['state'];
}) {
  const legs = state?.legs ?? [];
  const out = legs.some((l) => l.number_disclosed);
  const asked = legs.filter((l) => l.number_requested_by_callee).length;
  const offered = legs.filter((l) => l.callback_requested_by_callee).length;
  const facts = new Set(legs.flatMap((l) => l.disclosed_about_person)).size;
  const first = errand.person.name.split(' ')[0];

  return (
    <aside className={`rail ${out ? 'out' : 'held'}`}>
      <div className="sigil">
        <span className="ring" aria-hidden="true" />
        <svg viewBox="0 0 24 24" role="img" aria-label={out ? 'Number disclosed' : 'Number held'}>
          <path d={PHONE_PATH} />
          {!out && (
            <line x1="4.2" y1="19.8" x2="19.8" y2="4.2" className="slash" />
          )}
        </svg>
      </div>

      <p className="rail-status">{out ? 'Number out' : 'Line held'}</p>
      <p className="rail-num">{errand.person.phone_masked}</p>
      <p className="rail-say">
        {out
          ? 'It was said on a call. Everything else on this page is now unreliable.'
          : `${first} has answered no calls, and nobody has a number to ring.`}
      </p>

      <dl className="tally">
        <div>
          <dt>Calls placed</dt>
          <dd>{legs.length}</dd>
        </div>
        <div>
          <dt>Callbacks declined</dt>
          <dd>{offered}</dd>
        </div>
        <div className={asked ? 'hot' : undefined}>
          <dt>Times asked for it</dt>
          <dd>{asked}</dd>
        </div>
        <div>
          <dt>Facts disclosed</dt>
          <dd>{facts}</dd>
        </div>
        <div className={out ? 'bad' : 'ok'}>
          <dt>Times given out</dt>
          <dd>{out ? legs.filter((l) => l.number_disclosed).length : 0}</dd>
        </div>
      </dl>

      <p className="rail-foot">
        {out
          ? 'Not through a field — there is none. It was spoken aloud, which is why every transcript is re-scanned afterwards.'
          : 'There is no phone field in the result schema, so there is nowhere for the number to go.'}
      </p>
    </aside>
  );
}

export default function Console({ errand }: { errand: ClientErrand }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [active, setActive] = useState('happy');
  const [pending, start] = useTransition();

  function run(id: string) {
    setActive(id);
    const url = id === 'happy' ? window.location.pathname : `?s=${id}`;
    window.history.replaceState(null, '', url);
    start(async () => setResult(await runScenario(id)));
  }

  // The default scenario is shown as selected, so it should also be the one on
  // screen. Landing on an empty timeline under a pressed button reads as broken.
  // `?s=<id>` deep-links a scenario, so a demo can link straight to the leak.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('s');
    const id = SCENARIOS.some((s) => s.id === wanted) ? wanted! : 'happy';
    setActive(id);
    start(async () => setResult(await runScenario(id)));
  }, []);

  const state = result?.state;
  const last = state?.legs.at(-1);
  const first = errand.person.name.split(' ')[0];

  return (
    <main>
      <header className="masthead">
        <p className="wordmark">Withheld</p>
        <h1>
          A callback is a door you cannot open.
          <br />
          So <em>never accept one.</em>
        </h1>
        <p className="sub">
          Errands end with <i>&ldquo;we&rsquo;ll call you back.&rdquo;</i> If you
          cannot answer a phone, that ends the errand. Withheld declines, takes a
          time window, and rings back itself.
        </p>
      </header>

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

      <div className="shell">
        <ol className="timeline">
        <Step glyph="&#9670;" title="Before anyone dials" tone="setup">
          <div className="facts">
            <div>
              <span>For</span>
              <b>{errand.person.name}</b>
            </div>
            <div>
              <span>Calling</span>
              <b>{errand.callee.name}</b>
            </div>
            <div>
              <span>Withheld</span>
              <b className="mono">{errand.person.phone_masked}</b>
            </div>
          </div>
          <p className="note">
            The real number never reaches this page &mdash; not on screen, not in
            page source. It stays server-side so the app can prove it was never
            said.
          </p>

          <p className="lede">May say</p>
          <ul className="chips">
            {errand.may_say.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>

          <p className="lede">May agree to</p>
          <ul className="chips">
            {errand.acceptable_windows.map((w) => (
              <li key={w.start}>{formatWindow(w.start, w.end)}</li>
            ))}
          </ul>

          <p className="lede">Never sent</p>
          <p className="note secret">{errand.reason}</p>
        </Step>

        {(pending || !result) && (
          <Step glyph="&hellip;" title="Running the errand" tone="wait">
            <p className="note">Replaying recorded calls. Nothing is dialled.</p>
          </Step>
        )}

        {result && !pending && (
          <>
            {state?.legs.map((leg) => (
              <LegSteps
                key={leg.leg}
                r={leg}
                turns={
                  result.transcripts.find((t) => t.leg === leg.leg)?.turns ?? []
                }
                scheduled={state.scheduled.find((s) => s.leg === leg.leg + 1)}
              />
            ))}

            {state?.halted_reason && (
              <Step glyph="&#10006;" title="Handed back to a person" tone="bad">
                <p className="big">{state.halted_reason}</p>
              </Step>
            )}

            {state &&
              !state.halted_reason &&
              last?.status === 'errand_complete' && (
                <Step glyph="&#9733;" title="Errand complete" tone="win">
                  <p className="big">Booked across {state.legs.length} calls.</p>
                  <p className="verdict">
                    {first} answered none of them, and the clinic never had a
                    number to ring.
                  </p>
                </Step>
              )}
          </>
        )}
        </ol>

        <Rail errand={errand} state={state} />
      </div>

      <footer className="foot">
        Fixture replay &mdash; no API key, no calls placed. Nothing here trusts
        CALL-E&rsquo;s <code>taskCompleted</code>; every answer is re-derived from
        the transcript and shown with the turn behind it.
      </footer>
    </main>
  );
}

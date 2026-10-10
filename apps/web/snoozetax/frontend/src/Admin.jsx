/**
 * The prompt inspector.
 *
 * Every instruction SnoozeTax can give CALL-E, in one place: what it says, when
 * it fires, who it reaches, and the typed schema the agent has to fill in on the
 * way back. The server renders all of it from the same builders the live calls
 * use, so this page cannot show a script that is no longer the one being spoken.
 *
 * Read-only by design. Editing a prompt here would change what a real call says
 * to a real person, including the consent script that is the legal basis for
 * phoning a third party at all.
 */
import { useState } from 'react';
import { adminPrompts, errorText } from './api';

export default function Admin() {
  const [key, setKey] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const unlock = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      setData(await adminPrompts(key.trim()));
    } catch (e2) { setErr(errorText(e2)); }
    setLoading(false);
  };

  if (!data) {
    return (
      <main className="wrap app-main">
        <div className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>Prompt inspector</h2>
          <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
            Every instruction this system gives CALL-E. Read-only, and separate
            from your account.
          </p>
          <form onSubmit={unlock}>
            <label className="field">
              <span>Admin key</span>
              <input className="input" type="password" value={key} autoFocus
                     placeholder="From AWS SSM"
                     onChange={(ev) => setKey(ev.target.value)} />
            </label>
            {err && <p className="err">{err}</p>}
            <button className="btn" disabled={!key.trim() || loading}>
              {loading ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap app-main">
      <div className="card yellow">
        <h2 style={{ fontSize: 24, marginBottom: 6 }}>Prompt inspector</h2>
        <p style={{ fontSize: 15, opacity: .9 }}>
          Rendered live from the call builders, so what you read here is exactly
          what gets spoken. Names and numbers in angle brackets are placeholders;
          the wake-up code is a real one, drawn fresh on every load, because each
          alarm generates its own.
        </p>
        <div className="row wrapped" style={{ gap: 18, marginTop: 12, fontSize: 14, fontWeight: 700 }}>
          <span>Grace window: {data.graceMinutes} min</span>
          <span>Calls per alarm: up to {data.maxAttempts}</span>
          <span>Retry after: {data.retryAfterSeconds}s</span>
          <span>{data.dryRun ? 'DRY RUN' : 'LIVE: calls are billed'}</span>
        </div>
      </div>

      {data.calls.map((c) => (
        <div className="card" key={c.id} style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 19 }}>{c.title}</h3>
          <p className="muted" style={{ fontSize: 13.5, margin: '4px 0 2px' }}>
            <strong>Goes to:</strong> {c.to}
          </p>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
            <strong>Fires:</strong> {c.when}
          </p>

          <h4 style={{ fontSize: 14, marginBottom: 4 }}>Task prompt</h4>
          <pre className="code-block">{c.task}</pre>

          {c.retryTask && (
            <>
              <h4 style={{ fontSize: 14, margin: '12px 0 4px' }}>
                Task prompt on the second and final call
              </h4>
              <pre className="code-block">{c.retryTask}</pre>
            </>
          )}

          <h4 style={{ fontSize: 14, margin: '12px 0 4px' }}>
            Result schema{c.resultSchema ? '' : ': none'}
          </h4>
          {c.resultSchema
            ? <pre className="code-block">{JSON.stringify(c.resultSchema, null, 2)}</pre>
            : null}
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{c.schemaNote}</p>
          {c.note && (
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{c.note}</p>
          )}
        </div>
      ))}

      <div className="card pink" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 19, marginBottom: 6 }}>The challenge</h3>
        <p style={{ fontSize: 15, opacity: .95 }}>{data.challenge.rule}</p>

        <div className="challenge-demo">
          <div>
            <span className="cd-label">CALL-E says</span>
            <span className="cd-value">{data.challenge.example.code}</span>
          </div>
          <span className="cd-arrow" aria-hidden="true">→</span>
          <div>
            <span className="cd-label">You say</span>
            <span className="cd-value">{data.challenge.example.expected}</span>
          </div>
        </div>
        <p style={{ fontSize: 13, opacity: .85, textAlign: 'center', marginTop: -4 }}>
          Drawn live from the same generator the alarm uses. Reload to see a
          different one: no two mornings share a code.
        </p>

        <dl className="challenge-notes">
          <dt>Codes in play</dt>
          <dd>{data.challenge.poolSize} of the 900 three-digit numbers.</dd>
          <dt>Never issued</dt>
          <dd>
            <ul>
              {data.challenge.excluded.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </dd>
          <dt>Grading</dt>
          <dd>{data.challenge.grading}</dd>
          <dt>Showing the code</dt>
          <dd>{data.challenge.reveal}</dd>
        </dl>
      </div>
    </main>
  );
}

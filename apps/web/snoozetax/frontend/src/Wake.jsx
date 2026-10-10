import { useState, useEffect } from 'react';
import { api, errorText } from './api';
import { Clock } from './components';

const two = (n) => String(n).padStart(2, '0');

/**
 * The ten-minute rescue window. Reached from the alarm overlay or straight
 * from a /wake/<token> link, which needs no login on purpose: at 6am the user
 * should not have to authenticate to prove they are awake.
 */
export default function Wake({ token, onResolved }) {
  const [wake, setWake] = useState(null);
  const [answer, setAnswer] = useState('');
  const [left, setLeft] = useState(null);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  // Poll: the verdict can also arrive from the phone call via the webhook.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const w = await api(`/wake/${token}`);
        if (!alive) return;
        setWake(w);
        setLeft(w.secondsLeft);
        if (w.status === 'passed' || w.status === 'failed' || w.status === 'shamed') {
          onResolved?.(w);
        }
      } catch (e) { if (alive) setErr(errorText(e)); }
    };
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [token, onResolved]);

  const ticking = left !== null;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api(`/wake/${token}/answer`, { method: 'POST', body: { answer } });
      setWake(r.wake);
      onResolved?.(r.wake);
    } catch (e2) {
      setErr(errorText(e2));
      setShake(true);
      setAnswer('');
      setTimeout(() => setShake(false), 420);
    }
    setBusy(false);
  };

  if (err && !wake) return (
    <div className="auth-shell">
      <div className="card auth-card center">
        <h1>This link has expired</h1>
        <p className="sub" style={{ marginTop: 10 }}>{err}</p>
      </div>
    </div>
  );

  if (!wake) return (
    <div className="auth-shell"><p className="muted">Loading…</p></div>
  );

  if (wake.status === 'passed') return (
    <div className="auth-shell">
      <div className="card auth-card center">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <Clock size={104} mood="happy" />
        </div>
        <h1>You are up.</h1>
        <p className="sub" style={{ marginTop: 10 }}>
          {wake.resolvedVia === 'phone'
            ? 'Answered on the call. Nobody needs to hear about this.'
            : 'Typed in with time to spare. It counts.'}
        </p>
        {wake.soundedAwake === 'groggy' && (
          <p className="tag" style={{ marginTop: 8 }}>You did sound rough, though</p>
        )}
      </div>
    </div>
  );

  if (wake.status === 'failed' || wake.status === 'shamed') return (
    <div className="auth-shell">
      <div className="card auth-card center pink" style={{ color: 'var(--cream)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <Clock size={104} mood="dead" />
        </div>
        <h1>Time is up.</h1>
        <p style={{ marginTop: 10, opacity: .9 }}>
          {wake.status === 'shamed'
            ? 'Your accountability contact is being called right now.'
            : 'The window closed. This one goes down as a loss.'}
        </p>
      </div>
    </div>
  );

  const low = left !== null && left <= 60;

  return (
    <div className="auth-shell">
      <form className={`card auth-card ${shake ? 'shake' : ''}`} onSubmit={submit}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
          <span className="tag pink">Prove you are awake</span>
          <span className={`countdown ${low ? 'low' : ''}`} aria-live="polite">
            {left !== null ? `${two(Math.floor(left / 60))}:${two(left % 60)}` : '—'}
          </span>
        </div>

        {/* The code is only sent once every call is spent. While the phone is
            still going to ring, the page asks for the reversal without showing
            anything, so the call cannot be skipped from here. */}
        {wake.code ? (
          <>
            <h1>Type this backwards</h1>
            <div className="reveal-code" aria-label={`Your code is ${wake.code.split('').join(' ')}`}>
              {wake.code}
            </div>
            <p className="sub" style={{ marginTop: 10 }}>
              Both calls are done, so here is the code. Read it right to left and
              type what you get.
            </p>
          </>
        ) : (
          <>
            <h1>Say the code backwards</h1>
            <p className="sub" style={{ marginTop: 10 }}>
              Type the three digits from the call, in reverse order.
            </p>
          </>
        )}

        <label className="field">
          <span className="sr-only">The code, reversed</span>
          <input
            className="input big"
            value={answer} autoFocus
            inputMode="numeric"
            maxLength={3}
            onChange={(e) => setAnswer(e.target.value.replace(/\D/g, ''))}
            placeholder="000"
            required
          />
        </label>

        {err && <p className="err">{err}</p>}

        <button className="btn full" disabled={busy || !answer}>
          {busy ? 'Checking…' : 'I am awake'}
        </button>

        <p className="muted center" style={{ fontSize: 13, marginTop: 14 }}>
          When this hits zero, your accountability contact gets a phone call.
        </p>
      </form>
    </div>
  );
}

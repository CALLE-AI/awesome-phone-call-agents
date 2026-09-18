import { useState, useEffect, useRef } from 'react';
import { api, setToken, errorText } from './api';
import { Clock } from './components';

/**
 * Two steps: name and number, then the code.
 *
 * The code is shown HERE and read out by the USER on the call, not the other
 * way round. CALL-E refuses to place calls that recite verification codes, and
 * asking for it back proves more anyway: it shows somebody is holding the phone
 * right now, not merely that the number can receive a call.
 *
 * So the normal path never touches the keyboard: the page polls while the phone
 * is ringing and lets the user through the moment CALL-E reports they said it
 * correctly. Typing stays as the fallback for a call that never connected.
 */
export default function Auth({ onDone, onCancel }) {
  const [step, setStep] = useState('details');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [shownCode, setShownCode] = useState(null);
  const [expected, setExpected] = useState(null);
  const [typing, setTyping] = useState(false);
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const start = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/start', { method: 'POST', body: { name, phone } });
      setShownCode(r.code || null);
      setExpected(r.expected || null);
      setReturning(Boolean(r.returning));
      setStep('code');
    } catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  };

  // While the phone is ringing, wait for the webhook to report the code was
  // read back correctly. Stops on unmount so a cancelled signup stops polling.
  const pollRef = useRef(null);
  useEffect(() => {
    if (step !== 'code') return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api(`/auth/status?phone=${encodeURIComponent(phone)}`);
        if (!stop && r.verified) {
          setToken(r.token);
          onDone();
          return;
        }
      } catch { /* a failed poll is not worth surfacing: the user can still type */ }
      if (!stop) pollRef.current = setTimeout(tick, 2000);
    };
    pollRef.current = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(pollRef.current); };
  }, [step, phone, onDone]);

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/verify', { method: 'POST', body: { phone, code } });
      setToken(r.token);
      onDone();
    } catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  };

  if (step === 'details') return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={start}>
        <div style={{ marginBottom: 18 }}><Clock size={78} mood="sleepy" /></div>
        <h1>Let's hear your phone ring</h1>
        <p className="sub">
          We call you now to check the number works. That same number is the one
          we wake you on.
        </p>

        {/* Your number is the account. Clearing cookies loses the session, not
            the data, and people need to know that before they hesitate. */}
        <p className="reentry-note">
          Already used SnoozeTax? Enter the same number. Your alarm, your
          contact and your history are stored against it, so signing back in
          picks up exactly where you left off.
        </p>

        <label className="field">
          <span>Your name</span>
          <input className="input" value={name} autoComplete="given-name"
                 onChange={(e) => setName(e.target.value)}
                 placeholder="Alex" required />
        </label>

        <label className="field">
          <span>Mobile number</span>
          <input className="input mono" type="tel" value={phone} autoComplete="tel"
                 onChange={(e) => setPhone(e.target.value)}
                 placeholder="+34 600 000 000" required />
        </label>

        {err && <p className="err">{err}</p>}

        <button className="btn full" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? 'Dialling…' : 'Call me now'}
        </button>
        <button type="button" className="btn quiet full sm" style={{ marginTop: 10 }}
                onClick={onCancel}>
          Back
        </button>
      </form>
    </div>
  );

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={verify}>
        <div style={{ marginBottom: 18 }}>
          <Clock size={78} mood={returning ? 'happy' : 'panic'} />
        </div>
        <h1>{returning ? 'Welcome back' : 'Answer the call'}</h1>
        <p className="sub">
          {returning
            ? 'We recognised this number. Your phone is ringing now: pass the same challenge you get every morning and your alarm will be exactly as you left it.'
            : 'Your phone is ringing now. This is a practice run of your wake-up call, so you know exactly what 7am sounds like.'}
        </p>

        {/* The digits are shown so somebody can follow along or finish on the
            page if the call drops. The answer is deliberately not shown: saying
            the reverse is the whole proof. */}
        {shownCode && (
          <>
            <p className="code-label">CALL-E will read you these digits</p>
            <div className="reveal-code">{shownCode}</div>
            <p className="code-label">Say them back <strong>in reverse</strong></p>
          </>
        )}

        <p className="waiting-note" aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          Waiting for the call… you go straight through once you get it right.
        </p>

        {err && <p className="err">{err}</p>}

        {/* The fallback. A call that never connects must not strand anyone, but
            it stays folded away so it does not compete with the spoken path. */}
        {typing ? (
          <>
            <label className="field">
              <span className="sr-only">The digits in reverse</span>
              <input className="input big" inputMode="numeric" maxLength={3}
                     value={code} autoFocus
                     onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                     placeholder={expected ? '???' : '000'} required />
            </label>
            <button className="btn full" disabled={busy || code.length < 3}>
              {busy ? 'Checking…' : 'Let me in'}
            </button>
          </>
        ) : (
          <button type="button" className="btn quiet full sm" style={{ marginTop: 4 }}
                  onClick={() => setTyping(true)}>
            The call never came, let me type the answer instead
          </button>
        )}

        <button type="button" className="btn quiet full sm" style={{ marginTop: 10 }}
                onClick={() => { setStep('details'); setCode(''); setErr(''); setTyping(false); }}>
          Use a different number
        </button>
      </form>
    </div>
  );
}

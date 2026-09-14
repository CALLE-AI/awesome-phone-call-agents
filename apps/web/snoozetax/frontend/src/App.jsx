import { useState, useEffect, useCallback } from 'react';
import { api, getToken, clearToken, errorText } from './api';
import { Header, Footer, Clock } from './components';
import Landing from './Landing';
import Auth from './Auth';
import Wake from './Wake';
import Admin from './Admin';
import './pages.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const two = (n) => String(n).padStart(2, '0');

export default function App() {
  // A /wake/<token> link must work before anything else: it is opened half
  // asleep, often on a device that is not signed in.
  const wakeToken = window.location.pathname.startsWith('/wake/')
    ? window.location.pathname.split('/wake/')[1]
    : null;

  // The prompt inspector is its own route, not a tab: it is a back office with
  // its own key, and does not belong in the signed-in user's navigation.
  const isAdmin = window.location.pathname.startsWith('/admin');

  const [view, setView] = useState(wakeToken ? 'wake' : 'landing');
  const [me, setMe] = useState(null);
  const [alarms, setAlarms] = useState([]);
  const [ringing, setRinging] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const data = await api('/me');
      if (!data.user) { clearToken(); setLoading(false); return; }
      setMe(data);
      setAlarms(await api('/alarms'));
      setView((v) => (v === 'landing' || v === 'signup' ? 'app' : v));
      if (data.activeWake && !wakeToken) setRinging(data.activeWake);
    } catch { clearToken(); }
    setLoading(false);
  }, [wakeToken]);

  useEffect(() => { refresh(); }, [refresh]);

  // While an alarm is live, keep checking: the call may resolve it for us.
  useEffect(() => {
    if (!me || view !== 'app') return;
    const id = setInterval(async () => {
      try {
        const data = await api('/me');
        setMe(data);
        if (data.activeWake) setRinging(data.activeWake);
      } catch { /* offline is not fatal here */ }
    }, 5000);
    return () => clearInterval(id);
  }, [me?.user?.id, view]);

  // Clocky opens his eyes when an alarm is genuinely armed. "Enabled" alone is
  // not enough: an alarm with every day switched off will never ring.
  const armed = alarms.some((a) => a.enabled && a.days?.some(Boolean));

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* already gone */ }
    clearToken(); setMe(null); setAlarms([]); setView('landing');
  };

  // Checked before the loading gate: the inspector has nothing to do with the
  // user session, so it must not wait on /me to resolve first.
  if (isAdmin) {
    return (
      <>
        <Header user={me?.user} onNav={setView} onLogout={logout} awake />
        <Admin />
        <Footer awake />
      </>
    );
  }

  if (wakeToken) {
    return (
      <>
        <Header user={me?.user} onNav={setView} onLogout={logout} awake />
        <Wake token={wakeToken} />
        <Footer awake />
      </>
    );
  }

  if (loading) {
    return <div className="auth-shell"><p className="muted">Loading…</p></div>;
  }

  return (
    <>
      <Header user={me?.user} onNav={setView} onLogout={logout} awake={armed} />

      {ringing && (
        <RingOverlay
          wake={ringing}
          onDone={() => { setRinging(null); refresh(); }}
        />
      )}

      {!me && view === 'landing' && <Landing onStart={() => setView('signup')} />}
      {!me && view === 'signup' && (
        <Auth onDone={refresh} onCancel={() => setView('landing')} />
      )}

      {me && (
        <main className="wrap app-main">
          <div className="app-tabs">
            <button className={view === 'app' ? 'on' : ''} onClick={() => setView('app')}>Alarm</button>
            <button className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>History</button>
            <button className={view === 'settings' ? 'on' : ''} onClick={() => setView('settings')}>Settings</button>
          </div>

          {view === 'app' && (
            <AlarmPanel
              alarm={alarms[0]}
              me={me}
              onChange={refresh}
              onRing={(w) => setRinging(w)}
            />
          )}
          {view === 'history' && <History stats={me.stats} />}
          {view === 'settings' && <Settings me={me} onSaved={refresh} />}
        </main>
      )}

      <Footer awake={armed} />
    </>
  );
}

/* ── The alarm ──────────────────────────────────────────────────── */

function AlarmPanel({ alarm, me, onChange, onRing }) {
  const [draft, setDraft] = useState(alarm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [calling, setCalling] = useState(false);
  // What the last test actually sent to CALL-E: the task prompt and the schema
  // the agent must fill in. Supplied by the server, never rebuilt here, so it
  // cannot drift from the call that was really placed.
  const [sent, setSent] = useState(null);
  const [showSent, setShowSent] = useState(false);

  // Resync the draft whenever the saved alarm changes, comparing every field
  // rather than a hand-picked few: watching only id/hour/minute meant a saved
  // day or label change never refreshed the draft, so `dirty` stayed true and
  // the button sat on "Save changes" forever even though the save succeeded.
  const savedKey = alarm && JSON.stringify(alarm);
  useEffect(() => { setDraft(alarm); }, [savedKey]);
  if (!draft) return <p className="muted">No alarm yet.</p>;

  const dirty = alarm && (
    draft.hour !== alarm.hour || draft.minute !== alarm.minute ||
    draft.label !== alarm.label ||
    JSON.stringify(draft.days) !== JSON.stringify(alarm.days)
  );

  const save = async (patch = {}) => {
    setSaving(true); setErr('');
    try {
      await api(`/alarms/${alarm.id}`, { method: 'PUT', body: { ...draft, ...patch } });
      await onChange();
    } catch (e) { setErr(errorText(e)); }
    setSaving(false);
  };

  const ring = async () => {
    setErr('');
    setCalling(true);
    try {
      const r = await api(`/alarms/${alarm.id}/ring`, { method: 'POST' });
      setSent(r.sent || null);
      onRing(r.wake);
    } catch (e) { setErr(errorText(e)); }
    setCalling(false);
  };

  const nextRing = () => {
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      d.setHours(draft.hour, draft.minute, 0, 0);
      const idx = (d.getDay() + 6) % 7;
      if (d > now && draft.days[idx]) {
        const hrs = Math.round((d - now) / 3600000);
        return i === 0 ? `in about ${hrs} hour${hrs === 1 ? '' : 's'}` : `${DAYS[idx]}, in about ${hrs} hours`;
      }
    }
    return 'never, with no days selected';
  };

  return (
    <div className="alarm-card">
      <div className="card yellow">
        <div className="row wrapped" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, opacity: .7 }}>
              {draft.enabled ? `Next call ${nextRing()}` : 'Alarm is off'}
            </p>
            <div className="alarm-time">{two(draft.hour)}:{two(draft.minute)}</div>
            <p style={{ fontWeight: 600, marginTop: 4 }}>{draft.label || 'Wake up'}</p>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <Clock size={84} mood={draft.enabled ? 'panic' : 'sleepy'} />
            <button
              className={`switch ${draft.enabled ? 'on' : ''}`}
              role="switch" aria-checked={draft.enabled}
              aria-label="Alarm on"
              onClick={() => { setDraft({ ...draft, enabled: !draft.enabled }); save({ enabled: !draft.enabled }); }}
            >
              <span className="knob" />
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <label className="field">
          <span>Wake me at</span>
          <div className="time-edit">
            <select value={draft.hour} aria-label="Hour"
                    onChange={(e) => setDraft({ ...draft, hour: +e.target.value })}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{two(i)}</option>)}
            </select>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 800 }}>:</span>
            <select value={draft.minute} aria-label="Minute"
                    onChange={(e) => setDraft({ ...draft, minute: +e.target.value })}>
              {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{two(i)}</option>)}
            </select>
          </div>
        </label>

        <label className="field">
          <span>Which days</span>
          <div className="days">
            {DAYS.map((d, i) => (
              <button key={d} type="button"
                      className={`day ${draft.days[i] ? 'on' : ''}`}
                      aria-pressed={draft.days[i]}
                      onClick={() => {
                        const days = [...draft.days];
                        days[i] = !days[i];
                        setDraft({ ...draft, days });
                      }}>
                {d[0]}{d[1]}
              </button>
            ))}
          </div>
        </label>

        <label className="field">
          <span>Label</span>
          <input className="input" value={draft.label}
                 placeholder="Gym, no excuses"
                 onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </label>

        {err && <p className="err">{err}</p>}

        <div className="row wrapped" style={{ marginTop: 8 }}>
          <button className="btn" disabled={!dirty || saving} onClick={() => save()}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
          <button className="btn paper" onClick={ring} disabled={calling}>
            {calling ? 'Calling…' : 'Test the call'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          CALL-E reads out a three digit code and you say it back in reverse.
          Exactly what happens when the alarm fires for real.
        </p>

        {sent && (
          <div className="sent-panel" style={{ marginTop: 14 }}>
            <button type="button" className="btn paper" style={{ fontSize: 14 }}
                    aria-expanded={showSent}
                    onClick={() => setShowSent(!showSent)}>
              {showSent ? 'Hide' : 'Show'} what was sent to CALL-E
            </button>
            {showSent && (
              <div style={{ marginTop: 10 }}>
                <h4 style={{ fontSize: 15, marginBottom: 4 }}>The task prompt</h4>
                <pre className="code-block">{sent.task}</pre>
                <h4 style={{ fontSize: 15, margin: '12px 0 4px' }}>
                  The result schema CALL-E must fill in
                </h4>
                <pre className="code-block">{JSON.stringify(sent.resultSchema, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {!me.user.hasContact && (
        <div className="card pink">
          <h3 style={{ fontSize: 19, marginBottom: 8 }}>No witness, no stakes</h3>
          <p style={{ opacity: .92, fontSize: 15 }}>
            {me.user.contactStatus === 'pending'
              ? 'Your contact has not agreed yet. Until they say yes on the permission call, oversleeping costs you nothing but a broken streak.'
              : me.user.contactStatus === 'declined'
                ? 'Your contact said no, so nobody will be called. Name someone else in Settings.'
                : me.user.contactStatus === 'unreachable'
                  ? 'CALL-E could not reach your contact to ask permission. Try again in Settings.'
                  : 'Without an accountability contact, oversleeping costs you nothing but a broken streak. Add someone in Settings.'}
          </p>
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: 19, marginBottom: 4 }}>What happens tomorrow morning</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
          At {two(draft.hour)}:{two(draft.minute)}, in this order. Getting it
          right at any point ends the sequence.
        </p>

        <ol className="timeline">
          <li>
            <span className="t">{two(draft.hour)}:{two(draft.minute)}</span>
            <div>
              <strong>CALL-E phones you</strong>
              <p>Three digits, read out loud. Say them back in reverse order.</p>
            </div>
          </li>
          <li>
            <span className="t">+1 min</span>
            <div>
              <strong>No answer? It rings again</strong>
              <p>One more call, so a phone you slept through does not cost you
                 the morning. Answer and get it wrong and it goes to the page
                 below instead: you are already awake.</p>
            </div>
          </li>
          <li>
            <span className="t">+10 min</span>
            <div>
              <strong>Ten minutes on this page</strong>
              <p>After the last call the code appears here, so a phone that was
                 face-down is never an automatic loss. You still do the reversing.</p>
            </div>
          </li>
          <li className={me.user.hasContact ? 'bad' : ''}>
            <span className="t">then</span>
            <div>
              <strong>
                {me.user.hasContact
                  ? `CALL-E phones ${me.user.contactName || 'your contact'}`
                  : 'Your streak breaks'}
              </strong>
              <p>
                {me.user.hasContact
                  ? 'They agreed to this, and they are told you are still in bed.'
                  : 'Nobody is called, because you have no confirmed accountability contact yet.'}
              </p>
            </div>
          </li>
        </ol>
      </div>

      <div className="card flat" style={{ background: 'transparent', border: '2px dashed rgba(22,20,14,.3)', boxShadow: 'none' }}>
        <p style={{ fontSize: 14 }} className="muted">
          One alarm for now. Multiple alarms, each with their own days and witness,
          are already in the database and land next.
        </p>
      </div>
    </div>
  );
}

/* ── Ringing overlay ────────────────────────────────────────────── */

function RingOverlay({ wake, onDone }) {
  const [answering, setAnswering] = useState(false);
  if (answering) {
    return (
      <div className="overlay dim">
        <div style={{ width: '100%', maxWidth: 470 }}>
          <Wake token={wake.token} onResolved={() => setTimeout(onDone, 2200)} />
        </div>
      </div>
    );
  }
  return (
    <div className="overlay alarm">
      <div className="ring-inner">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Clock size={132} mood="panic" />
        </div>
        <div className="ring-clock">{two(new Date().getHours())}:{two(new Date().getMinutes())}</div>
        <p style={{ fontWeight: 800, fontSize: 19, marginBottom: 6 }}>
          CALL-E is phoning you right now.
        </p>
        <p className="muted" style={{ marginBottom: 26, fontSize: 15 }}>
          Answer it and reply out loud. If you missed it, you have ten minutes
          to do this the hard way.
        </p>
        <div className="stack" style={{ gap: 12 }}>
          <button className="btn lg ink full" onClick={() => setAnswering(true)}>
            I missed the call, let me type it
          </button>
          <button className="btn quiet full sm" onClick={onDone}>
            Hide this
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── History ────────────────────────────────────────────────────── */

function History({ stats }) {
  if (!stats || stats.total === 0) return (
    <div className="card center" style={{ padding: 52 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <Clock size={92} mood="sleepy" />
      </div>
      <h2 style={{ fontSize: 24, marginBottom: 8 }}>Nothing to report yet</h2>
      <p className="muted">Your first wake-up call will show up here, transcript and all.</p>
    </div>
  );

  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="card stat"><div className="n">{stats.streak}</div><div className="l">Morning streak</div></div>
        <div className="card stat"><div className="n">{stats.passed}</div><div className="l">Mornings won</div></div>
        <div className="card stat"><div className="n">{stats.failed}</div><div className="l">Slept through</div></div>
        <div className="card stat"><div className="n">{stats.groggy}</div><div className="l">Sounded rough</div></div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 19, marginBottom: 6 }}>How you got up</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
          {stats.byPhone} on the call, {stats.byWeb} typed in during the ten minutes.
        </p>

        {stats.recent.map((r, i) => (
          <div className="log-row" key={i}>
            <span className={`tag ${r.status === 'passed' ? 'green' : r.status === 'shamed' ? 'pink' : ''}`}>
              {r.status === 'passed' ? 'Awake' : r.status === 'shamed' ? 'Witness called' : r.status === 'failed' ? 'Slept through' : 'In progress'}
            </span>
            <span className="mono" style={{ fontSize: 13 }}>
              {new Date(r.fired_at + 'Z').toLocaleString()}
            </span>
            {r.resolved_via && <span className="muted" style={{ fontSize: 13 }}>via {r.resolved_via}</span>}
            {r.sounded_awake === 'groggy' && <span className="tag">groggy</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Settings ───────────────────────────────────────────────────── */

function Settings({ me, onSaved }) {
  const [name, setName] = useState(me.user.contactName || '');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showScript, setShowScript] = useState(false);

  // Nobody should name a witness without knowing what that witness will be
  // told. The text comes from the server so it is the real task, not a copy.
  useEffect(() => {
    let live = true;
    api('/me/contact/preview')
      .then((p) => { if (live) setPreview(p); })
      .catch(() => { /* the preview is a nicety, not a blocker */ });
    return () => { live = false; };
  }, [me.user.contactName, me.user.contactPhone]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setOk(false);
    try {
      const r = await api('/me/contact', { method: 'POST', body: { contactName: name, contactPhone: phone } });
      setOk(r.status === 'pending' ? 'asking' : true); setPhone('');
      await onSaved();
    } catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  };

  const reask = async () => {
    setBusy(true); setErr('');
    try { await api('/me/contact/reask', { method: 'POST' }); await onSaved(); }
    catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true); setErr('');
    try { await api('/me/contact', { method: 'DELETE' }); setName(''); await onSaved(); }
    catch (e2) { setErr(errorText(e2)); }
    setBusy(false);
  };

  const status = me.user.contactStatus || 'none';
  const CONSENT = {
    pending:     { tag: 'yellow', label: 'Waiting for their answer',
                   text: 'CALL-E is asking them for permission. Until they say yes, they will not be called about you oversleeping.' },
    confirmed:   { tag: 'green', label: 'They said yes',
                   text: 'They agreed on the call. They can opt out at any time by telling CALL-E during a call, or you can remove them here.' },
    declined:    { tag: 'pink', label: 'They said no',
                   text: 'They declined, so they will never be called. That answer is final: use a different number, or ask them yourself first.' },
    unreachable: { tag: '', label: 'Could not reach them',
                   text: 'Nobody answered, so there is no permission on record and no call will be made. You can try asking again.' },
  }[status];

  return (
    <div className="stack" style={{ maxWidth: 620 }}>
      <div className="card">
        <h3 style={{ fontSize: 21, marginBottom: 6 }}>Your account</h3>
        <div className="log-row"><span className="muted">Name</span><span className="grow" /><strong>{me.user.name}</strong></div>
        <div className="log-row"><span className="muted">Verified number</span><span className="grow" /><span className="mono">{me.user.phone}</span></div>
      </div>

      <form className="card" onSubmit={save}>
        <h3 style={{ fontSize: 21, marginBottom: 6 }}>Accountability contact</h3>
        <p className="muted" style={{ fontSize: 14.5, marginBottom: 20 }}>
          If you never wake up, CALL-E phones this person and tells them. Because
          they never signed up themselves, CALL-E calls them once first to ask
          permission, and only calls again if they say yes.
        </p>

        {CONSENT && (
          <div className="consent-state">
            <div className="row" style={{ gap: 10, marginBottom: 8 }}>
              <span className={`tag ${CONSENT.tag}`}>{CONSENT.label}</span>
              {me.user.contactPhone && (
                <span className="mono" style={{ fontSize: 13 }}>{me.user.contactPhone}</span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 14 }}>{CONSENT.text}</p>

            {me.user.contactConsentQuote && (
              <p className="consent-quote">“{me.user.contactConsentQuote}”</p>
            )}

            <div className="row wrapped" style={{ gap: 10, marginTop: 14 }}>
              {(status === 'unreachable' || status === 'pending') && (
                <button type="button" className="btn sm paper" disabled={busy} onClick={reask}>
                  Ask again
                </button>
              )}
              <button type="button" className="btn sm quiet" disabled={busy} onClick={remove}>
                Remove them
              </button>
            </div>
          </div>
        )}

        <label className="field">
          <span>Their name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Mum" />
        </label>

        <label className="field">
          <span>Their number</span>
          {/* Never seed this with the stored number: it is masked, so it would
              look editable while being impossible to retype correctly. */}
          <input className="input mono" type="tel" value={phone}
                 onChange={(e) => setPhone(e.target.value)}
                 placeholder="+34 600 000 000" />
          {me.user.contactPhone && !phone && (
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              A new number replaces {me.user.contactPhone} and needs its own
              permission call.
            </p>
          )}
        </label>

        {preview && (
          <div className="script-box">
            <button type="button" className="script-toggle"
                    aria-expanded={showScript}
                    onClick={() => setShowScript((v) => !v)}>
              <span>What CALL-E will say to them</span>
              <span className="mark">{showScript ? '−' : '+'}</span>
            </button>
            {showScript && (
              <div className="script-body">
                <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                  These are the exact instructions sent to CALL-E. It speaks them
                  in its own words, so the wording varies but the content does not.
                </p>
                <h4 className="script-head">1. Asking permission, once</h4>
                <p className="script-text">{preview.consentTask}</p>
                <h4 className="script-head">2. Only if they agreed, and only when you oversleep</h4>
                <p className="script-text">{preview.task}</p>
              </div>
            )}
          </div>
        )}

        {err && <p className="err">{err}</p>}
        {ok === 'asking' && (
          <p style={{ color: 'var(--green)', fontWeight: 700, fontSize: 14 }}>
            Saved. CALL-E is phoning them now to ask permission.
          </p>
        )}
        {ok === true && (
          <p style={{ color: 'var(--green)', fontWeight: 700, fontSize: 14 }}>Contact saved.</p>
        )}

        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button>
      </form>

      <div className="card ink">
        <h3 style={{ fontSize: 19, marginBottom: 8, color: 'var(--yellow)' }}>
          Getting the call through Do Not Disturb
        </h3>
        <p style={{ fontSize: 14.5, color: 'rgba(255,248,231,.8)' }}>
          Save the number that calls you as a contact, then turn on Emergency Bypass
          on iPhone, or mark it as a priority contact on Android. The caller ID can
          vary between mornings, which is exactly why the ten-minute web window
          exists.
        </p>
      </div>
    </div>
  );
}

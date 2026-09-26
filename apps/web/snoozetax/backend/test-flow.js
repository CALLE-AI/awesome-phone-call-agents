/**
 * End-to-end flow test against the real HTTP surface, in dry-run.
 * No phone calls are placed and no credits are spent.
 */
process.env.DB_PATH = '/tmp/snoozetax-test.sqlite';
process.env.DRY_RUN = 'true';
require('node:fs').rmSync('/tmp/snoozetax-test.sqlite', { force: true });

const { app, tick } = require('./index');
const wake = require('./lib/wake');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const server = app.listen(4099, async () => {
  const B = 'http://localhost:4099';
  const call = async (path, opts = {}) => {
    const res = await fetch(B + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  console.log('\n1. Signup + phone verification');
  let r = await call('/api/auth/start', { method: 'POST', body: JSON.stringify({ name: 'Alex', phone: '+447700900111' }) });
  check('verification call placed', r.body.ok === true);
  // Sign-up is a rehearsal of the wake-up call: the digits are read out and the
  // answer is their reverse, so both are returned for the page to display.
  const code = r.body.code, expected = r.body.expected;
  check('signup returns the digits and their reverse', Boolean(code) && Boolean(expected));

  r = await call('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone: '+447700900111', code: '0000' }) });
  check('wrong code rejected', r.status === 400 && r.body.error === 'wrong_code');

  r = await call('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone: '+447700900111', code: expected }) });
  check('correct code issues session', r.body.ok === true && Boolean(r.body.token));
  const token = r.body.token;
  const AUTH = { Authorization: `Bearer ${token}` };

  // The spoken path: CALL-E reports the user read the code out correctly, and
  // /auth/status hands back a session with nothing ever typed. This is the
  // normal route now; the typed check above is the fallback.
  console.log('\n1b. Verifying by saying the code on the call');
  const dbv = require('./lib/db');
  r = await call('/api/auth/start', { method: 'POST', body: JSON.stringify({ name: 'Spoken', phone: '+447700900333' }) });
  const vCallId = dbv.prepare('SELECT call_id c FROM verifications WHERE phone=?').get('+447700900333').c;

  r = await call('/api/auth/status?phone=%2B447700900333');
  check('not verified until the call reports back', r.body.verified === false);

  // Wrong digits must not let anyone in.
  await call('/api/webhook/calle', {
    method: 'POST', headers: { 'CALL-E-Event-Id': 'evt_v0' },
    body: JSON.stringify({ id: 'evt_v0', type: 'call.completed', data: {
      id: vCallId, status: 'completed',
      metadata: { purpose: 'verification', phone: '+447700900333' },
      structured_result: { answer_correct: 'no', spoken_answer: '000' },
    } }),
  });
  r = await call('/api/auth/status?phone=%2B447700900333');
  check('a wrong answer on the call does not verify', r.body.verified === false);

  await call('/api/webhook/calle', {
    method: 'POST', headers: { 'CALL-E-Event-Id': 'evt_v1' },
    body: JSON.stringify({ id: 'evt_v1', type: 'call.completed', data: {
      id: vCallId, status: 'completed',
      metadata: { purpose: 'verification', phone: '+447700900333' },
      structured_result: { answer_correct: 'yes', spoken_answer: 'reversed' },
    } }),
  });
  r = await call('/api/auth/status?phone=%2B447700900333');
  check('reversing the digits on the call issues a session', r.body.verified === true && Boolean(r.body.token));
  check('spoken verification creates the user', r.body.user?.name === 'Spoken');

  // The verification row is consumed, so the same call cannot be replayed.
  r = await call('/api/auth/status?phone=%2B447700900333');
  check('a consumed verification cannot be replayed', r.body.verified === false);

  console.log('\n2. Session persistence (the re-entry problem)');
  r = await call('/api/me', { headers: AUTH });
  check('session returns user', r.body.user?.name === 'Alex');
  check('phone is masked in API output', r.body.user.phone.includes('*'), r.body.user.phone);
  r = await call('/api/me');
  check('no session -> no user', r.body.user === null);

  console.log('\n3. Alarms');
  r = await call('/api/alarms', { headers: AUTH });
  check('new account seeded with one alarm', r.body.length === 1);
  const alarmId = r.body[0].id;
  r = await call(`/api/alarms/${alarmId}`, { method: 'PUT', headers: AUTH, body: JSON.stringify({ hour: 6, minute: 30, label: 'Gym', days: [true,true,true,true,true,false,false] }) });
  check('alarm updates', r.body.hour === 6 && r.body.minute === 30 && r.body.label === 'Gym');
  r = await call(`/api/alarms/${alarmId}`, { method: 'PUT', headers: AUTH, body: JSON.stringify({ hour: 99 }) });
  check('invalid hour rejected', r.status === 400);
  r = await call('/api/alarms', { method: 'POST', headers: AUTH, body: JSON.stringify({ hour: 8, minute: 0 }) });
  check('second alarm blocked (multi-alarm coming soon)', r.status === 403 && r.body.error === 'multi_alarm_soon');
  r = await call('/api/alarms', {});
  check('alarms require auth', r.status === 401);

  console.log('\n3b. Re-entry: data survives, old sessions do not');
  // Someone clears their cookies and signs in again with the same number.
  const oldToken = AUTH.Authorization.slice(7);
  r = await call('/api/auth/start', { method: 'POST', body: JSON.stringify({ name: 'Alex', phone: '+447700900111' }) });
  check('a known number is flagged as returning', r.body.returning === true);
  const expected2 = r.body.expected;
  r = await call('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone: '+447700900111', code: expected2 }) });
  check('re-verify reports a returning user', r.body.returning === true);
  const newToken = r.body.token;
  check('a fresh session is issued', Boolean(newToken) && newToken !== oldToken);

  r = await call('/api/me', { headers: { Authorization: `Bearer ${oldToken}` } });
  check('the previous session is revoked', !r.body.user);

  r = await call('/api/alarms', { headers: { Authorization: `Bearer ${newToken}` } });
  check('the alarm survived losing the session', r.body[0]?.id === alarmId);

  // Everything after this point uses the new session.
  AUTH.Authorization = `Bearer ${newToken}`;

  console.log('\n4. Accountability contact needs its own consent');
  const dbc = require('./lib/db');
  r = await call('/api/me/contact', { method: 'POST', headers: AUTH, body: JSON.stringify({ contactName: 'Mum', contactPhone: '+447700900222' }) });
  check('contact saved', r.body.ok === true);
  check('contact starts pending, not armed', r.body.status === 'pending');

  r = await call('/api/me', { headers: AUTH });
  check('pending contact does not count as armed', r.body.user.hasContact === false);

  check('cannot nominate yourself', (await call('/api/me/contact', {
    method: 'POST', headers: AUTH, body: JSON.stringify({ contactName: 'Me', contactPhone: '+447700900111' }),
  })).status === 400);

  // A contact who declines must never be callable, and re-asking is refused.
  const consentCallId = dbc.prepare('SELECT contact_call_id c FROM users WHERE id=1').get().c;
  await call('/api/webhook/calle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CALL-E-Event-Id': 'evt_c1' },
    body: JSON.stringify({ id: 'evt_c1', type: 'call.completed', data: {
      id: consentCallId, status: 'completed', metadata: { purpose: 'consent', user_id: '1' },
      structured_result: { consent: 'declined', consent_quote: 'No thanks, please do not call me.' },
    } }),
  });
  r = await call('/api/me', { headers: AUTH });
  check('decline is recorded', r.body.user.contactStatus === 'declined');
  check('declined contact is not armed', r.body.user.hasContact === false);
  check('re-asking a decline is refused',
    (await call('/api/me/contact/reask', { method: 'POST', headers: AUTH })).status === 403);

  // Now let them agree, which is what arms the shame call later.
  await call('/api/me/contact', { method: 'POST', headers: AUTH, body: JSON.stringify({ contactName: 'Mum', contactPhone: '+447700900222' }) });
  const consentCallId2 = dbc.prepare('SELECT contact_call_id c FROM users WHERE id=1').get().c;
  await call('/api/webhook/calle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CALL-E-Event-Id': 'evt_c2' },
    body: JSON.stringify({ id: 'evt_c2', type: 'call.completed', data: {
      id: consentCallId2, status: 'completed', metadata: { purpose: 'consent', user_id: '1' },
      structured_result: { consent: 'granted', consent_quote: 'Yes, that is fine.' },
    } }),
  });
  r = await call('/api/me', { headers: AUTH });
  check('consent granted arms the contact', r.body.user.hasContact === true);
  check('consent quote kept as the record', r.body.user.contactConsentQuote === 'Yes, that is fine.');

  console.log('\n5. Ring -> wrong on phone -> rescued on web');
  r = await call(`/api/alarms/${alarmId}/ring`, { method: 'POST', headers: AUTH });
  check('alarm rings', r.body.ok === true);
  const wakeTok = r.body.wake.token;
  check('web token issued', Boolean(wakeTok));
  check('answer never leaked to client', !JSON.stringify(r.body).includes('expected_answer'));

  const db = require('./lib/db');
  const ev = db.prepare('SELECT * FROM wake_events ORDER BY id DESC LIMIT 1').get();

  // An unanswered call: 'unknown' is the schema's "no human was reached", and
  // it is the ONLY result that earns another ring.
  r = await call('/api/webhook/calle', {
    method: 'POST',
    headers: { 'CALL-E-Event-Id': 'evt_1' },
    body: JSON.stringify({
      id: 'evt_1', type: 'call.completed',
      data: {
        id: 'call_1', status: 'completed',
        metadata: { purpose: 'wake', wake_event_id: String(ev.id) },
        structured_result: { answer_correct: 'unknown', sounded_awake: 'unknown', spoken_answer: '' },
        recipients: [{ attempts: [{ transcript_turns: [{ offset_seconds: 0, speaker: 'bot', text: 'Good morning' }] }] }],
      },
    }),
  });
  check('webhook accepted', r.body.received === true);

  r = await call(`/api/wake/${wakeTok}`);
  check('an unanswered call schedules a retry', r.body.status === 'retrying', r.body.status);
  check('attempt counted', r.body.attempts === 1 && r.body.maxAttempts === 2);
  check('transcript stored', Array.isArray(r.body.transcript) && r.body.transcript.length === 1);
  // Nothing may be revealed while the phone is still going to ring, or the call
  // could be bypassed from the browser without ever picking up.
  check('code stays hidden while a call is still coming', r.body.code === null, r.body.code);

  // The retry becomes due a minute later: pull it forward and tick.
  db.prepare("UPDATE wake_events SET retry_at=datetime('now','-1 second') WHERE id=?").run(ev.id);
  tick();
  await new Promise(res => setTimeout(res, 250));
  r = await call(`/api/wake/${wakeTok}`);
  check('retry places a second call', r.body.attempts === 2, `attempts=${r.body.attempts}`);
  check('retry is live again', r.body.status === 'calling', r.body.status);

  // Answer the second call and get it wrong. No attempts are left either way,
  // so the web window opens.
  await call('/api/webhook/calle', {
    method: 'POST',
    headers: { 'CALL-E-Event-Id': 'evt_1b' },
    body: JSON.stringify({
      id: 'evt_1b', type: 'call.completed',
      data: {
        id: 'call_1b', status: 'completed',
        metadata: { purpose: 'wake', wake_event_id: String(ev.id), attempt: '2' },
        structured_result: { answer_correct: 'no', sounded_awake: 'groggy', spoken_answer: 'still nine' },
        recipients: [{ attempts: [{ transcript_turns: [{ offset_seconds: 0, speaker: 'bot', text: 'Last try' }] }] }],
      },
    }),
  });
  r = await call(`/api/wake/${wakeTok}`);
  check('after the last call -> awaiting_web', r.body.status === 'awaiting_web', r.body.status);
  check('no third call is scheduled', r.body.retryInSeconds === null);
  check('grogginess captured', r.body.soundedAwake === 'groggy');
  check('transcripts accumulate across attempts', r.body.transcript.length === 2, `n=${r.body.transcript?.length}`);
  check('code revealed once nothing more will ring', r.body.code === ev.question, r.body.code);
  check(
    `web window is a full ${wake.GRACE_MINUTES} minutes from the last call`,
    r.body.secondsLeft > wake.GRACE_MINUTES * 60 - 10, `${r.body.secondsLeft}s`,
  );

  r = await call('/api/webhook/calle', {
    method: 'POST', headers: { 'CALL-E-Event-Id': 'evt_MISMATCH' },
    body: JSON.stringify({ id: 'evt_1', type: 'call.completed', data: {} }),
  });
  check('spoofed webhook id rejected', r.status === 400);

  r = await call(`/api/wake/${wakeTok}/answer`, { method: 'POST', body: JSON.stringify({ answer: 'wrong' }) });
  check('wrong web answer rejected', r.status === 400 && r.body.error === 'wrong');

  const answer = ev.mode === 'code' ? ev.expected_answer : ev.expected_answer;
  r = await call(`/api/wake/${wakeTok}/answer`, { method: 'POST', body: JSON.stringify({ answer }) });
  check('correct web answer passes', r.body.ok === true && r.body.wake.resolvedVia === 'web');

  // The other path into the web window: a human answered the FIRST call and got
  // it wrong. They are awake and holding the phone, so no second call is placed
  // even though an attempt is still nominally available.
  console.log('\n5b. Answered and failed on the first call -> web, no second call');
  r = await call(`/api/alarms/${alarmId}/ring`, { method: 'POST', headers: AUTH });
  const evW = db.prepare('SELECT * FROM wake_events ORDER BY id DESC LIMIT 1').get();
  await call('/api/webhook/calle', {
    method: 'POST',
    headers: { 'CALL-E-Event-Id': 'evt_2' },
    body: JSON.stringify({
      id: 'evt_2', type: 'call.completed',
      data: {
        id: 'call_2', status: 'completed',
        metadata: { purpose: 'wake', wake_event_id: String(evW.id) },
        structured_result: { answer_correct: 'no', sounded_awake: 'alert', spoken_answer: 'nine one four' },
        recipients: [{ attempts: [{ transcript_turns: [] }] }],
      },
    }),
  });

  r = await call(`/api/wake/${evW.web_token}`);
  check('a spoken wrong answer goes straight to the web', r.body.status === 'awaiting_web', r.body.status);
  check('no retry is scheduled despite an attempt remaining',
    r.body.attempts === 1 && r.body.retryInSeconds === null, `attempts=${r.body.attempts}`);
  check('code revealed to someone who fumbled it out loud', r.body.code === evW.question, r.body.code);

  // Prove the tick agrees: nothing must ring for this event.
  tick();
  await new Promise(res => setTimeout(res, 250));
  r = await call(`/api/wake/${evW.web_token}`);
  check('tick places no second call', r.body.attempts === 1 && r.body.status === 'awaiting_web', r.body.status);

  r = await call(`/api/wake/${evW.web_token}/answer`, {
    method: 'POST', body: JSON.stringify({ answer: evW.expected_answer }),
  });
  check('they can still rescue it on the web', r.body.ok === true && r.body.wake.resolvedVia === 'web');

  console.log('\n6. Oversleep -> accountability contact called');
  r = await call(`/api/alarms/${alarmId}/ring`, { method: 'POST', headers: AUTH });
  const ev2 = db.prepare('SELECT * FROM wake_events ORDER BY id DESC LIMIT 1').get();
  db.prepare('UPDATE wake_events SET deadline_at=? WHERE id=?')
    .run(new Date(Date.now() - 1000).toISOString(), ev2.id);
  tick();
  await new Promise(r => setTimeout(r, 250));
  const after = db.prepare('SELECT * FROM wake_events WHERE id=?').get(ev2.id);
  check('oversleep triggers shame call', after.status === 'shamed', `status=${after.status}`);
  check('shame call recorded', Boolean(after.shame_call_id));

  console.log('\n7. Stats');
  r = await call('/api/me', { headers: AUTH });
  check('stats counted', r.body.stats.total === 3 && r.body.stats.passed === 2 && r.body.stats.shamed === 1,
    JSON.stringify({ t: r.body.stats.total, p: r.body.stats.passed, s: r.body.stats.shamed }));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  server.close();
  process.exit(fail ? 1 : 0);
});

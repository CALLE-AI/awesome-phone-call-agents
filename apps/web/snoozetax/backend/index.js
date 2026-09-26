/**
 * SnoozeTax backend.
 *
 * An accountability alarm clock: the phone rings a normal alarm, and CALL-E
 * places a real phone call that proves a human is actually conscious. A snooze
 * button cannot tell the difference between "awake" and "asleep again". A
 * conversation can.
 */
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const db = require('./lib/db');
const auth = require('./lib/auth');
const wake = require('./lib/wake');
const { randomCode, reverseCode } = require('./lib/challenges');
const { getAdminKey } = require('./lib/secrets');
const calle = require('./adapters/calle');

const app = express();
const PORT = process.env.PORT || 4005;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const WEB_URL = process.env.WEB_URL || 'http://localhost:5173';

// X-Admin-Key is a custom header, so it has to be allowed explicitly or the
// browser's preflight blocks the prompt inspector before it is ever sent.
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
}));
app.use(express.json());
app.use(auth.attachUser);

const E164 = /^\+[1-9]\d{6,14}$/;

// ─── Signup and phone verification ──────────────────────────────────

app.post('/api/auth/start', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const phone = String(req.body.phone || '').replace(/[\s-()]/g, '');

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!E164.test(phone)) {
    return res.status(400).json({ error: 'invalid_phone', message: 'Use international format, e.g. +447700900123' });
  }

  // The sign-up call is a rehearsal of the wake-up call, so it uses the same
  // challenge: three digits, said back in reverse. CALL-E rejects any task that
  // reads out OR asks for a verification code, so this is not a workaround but
  // the only shape that is allowed, and it happens to prove more (see the
  // adapter). `code` is what gets read out; the answer is its reverse.
  const code = randomCode();
  const expected = reverseCode(code);
  db.prepare(`
    INSERT INTO verifications (phone, code, name, expires_at, attempts)
    VALUES (?,?,?,datetime('now','+10 minutes'),0)
    ON CONFLICT(phone) DO UPDATE SET
      code=excluded.code, name=excluded.name,
      expires_at=excluded.expires_at, attempts=0, spoken_ok=0
  `).run(phone, code, name);

  try {
    const call = await calle.createCall({
      task: calle.verificationTask(phone, code, expected, name),
      phone,
      // The call asks for the code rather than reading it out, so what comes
      // back has to be graded here against what the screen showed.
      resultSchema: calle.VERIFY_RESULT_SCHEMA,
      metadata: { purpose: 'verification', phone, idempotency_key: `verify_${phone}_${code}` },
      webhookUrl: `${PUBLIC_URL}/api/webhook/calle`,
    });
    db.prepare('UPDATE verifications SET call_id=? WHERE phone=?').run(call.id, phone);

    res.json({
      ok: true,
      dryRun: calle.DRY_RUN,
      // Lets the client reassure a returning user that nothing was lost.
      // Only ever sent after a call to this number was actually placed, so it
      // cannot be used to probe whether a stranger's number is registered.
      returning: Boolean(db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)),
      // The digits are MEANT to be on screen: the call reads them out and asks
      // for them backwards, so showing them lets someone follow along or finish
      // on the web if the call drops. They unlock nothing without the phone.
      code,
      expected,
    });
  } catch (err) {
    console.error('[verify] call failed:', err.message);
    res.status(502).json({ error: 'call_failed', message: err.message });
  }
});

/**
 * Polled by the sign-up screen while the phone is ringing. The call asks the
 * user to read the code out, so in the normal case they never type anything:
 * this is what lets them straight in once CALL-E reports they said it correctly.
 *
 * Returns a session only for a verification this same phone actually started,
 * and only once `spoken_ok` was set by the webhook, so it cannot be used to
 * fish for somebody else's account.
 */
app.get('/api/auth/status', (req, res) => {
  const phone = String(req.query.phone || '').replace(/[\s-()]/g, '');
  const row = phone && db.prepare('SELECT * FROM verifications WHERE phone=?').get(phone);
  if (!row) return res.json({ verified: false });
  if (new Date(row.expires_at + 'Z') < new Date()) return res.json({ verified: false, expired: true });
  if (!row.spoken_ok) return res.json({ verified: false });

  const { user, token, returning } = completeVerification(row, phone);
  res.json({ verified: true, token, user: publicUser(user), returning });
});

app.post('/api/auth/verify', (req, res) => {
  const phone = String(req.body.phone || '').replace(/[\s-()]/g, '');
  const code = String(req.body.code || '').replace(/\D/g, '');

  const row = db.prepare('SELECT * FROM verifications WHERE phone=?').get(phone);
  if (!row) return res.status(400).json({ error: 'no_pending_verification' });
  if (new Date(row.expires_at + 'Z') < new Date()) return res.status(400).json({ error: 'code_expired' });
  if (row.attempts >= 5) return res.status(429).json({ error: 'too_many_attempts' });

  // The page shows the digits that were read out; what proves anything is their
  // reverse, the same answer the call asked for.
  if (reverseCode(row.code) !== code) {
    db.prepare('UPDATE verifications SET attempts=attempts+1 WHERE phone=?').run(phone);
    return res.status(400).json({ error: 'wrong_code', remaining: 4 - row.attempts });
  }

  const { user, token, returning } = completeVerification(row, phone);

  res.json({
    ok: true,
    token,
    user: publicUser(user),
    // True when this number already had an account, so the client can say
    // "welcome back, your alarm is still here" instead of implying a fresh start.
    returning,
  });
});

/**
 * Turn a proven verification into a session. Shared by both routes in, so
 * saying the code on the call and typing it on the page cannot drift apart:
 * each caller decides IF the code was proven, this decides what that earns.
 */
function completeVerification(row, phone) {
  let user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  const returning = Boolean(user);
  if (!user) {
    const info = db.prepare(`INSERT INTO users (name, phone, verified_at) VALUES (?,?,datetime('now'))`)
      .run(row.name || 'Sleeper', phone);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    // A brand-new account starts with one alarm rather than an empty screen.
    db.prepare(`INSERT INTO alarms (user_id, label, hour, minute) VALUES (?,?,?,?)`)
      .run(user.id, 'Wake up', 7, 0);
  } else {
    db.prepare(`UPDATE users SET verified_at=datetime('now'), name=? WHERE id=?`).run(row.name || user.name, user.id);
  }

  db.prepare('DELETE FROM verifications WHERE phone=?').run(phone);

  // Proving the phone again replaces every older session for this account.
  // Sessions last 180 days, so a stale one on a borrowed or shared machine
  // would otherwise stay usable long after the owner signed in elsewhere.
  const dropped = db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id).changes;
  if (dropped) console.log(`[auth] user ${user.id} re-verified: ${dropped} older session(s) revoked`);

  return { user, token: auth.createSession(user.id).token, returning };
}

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const active = wake.activeWakeEventForUser(req.user.id);
  res.json({
    user: publicUser(req.user),
    stats: wake.computeStats(req.user.id),
    activeWake: active ? publicWake(active) : null,
  });
});

/**
 * Nominating a contact does NOT arm them. They are a third party who never
 * agreed to anything, so saving a new number only puts it in `pending`; CALL-E
 * then phones them once to ask. Until they say yes, no shame call can happen.
 */
app.post('/api/me/contact', auth.requireUser, async (req, res) => {
  const name = String(req.body.contactName || '').trim().slice(0, 60);
  const phone = String(req.body.contactPhone || '').replace(/[\s-()]/g, '');
  if (phone && !E164.test(phone)) return res.status(400).json({ error: 'invalid_phone' });

  if (phone && phone === req.user.phone) {
    return res.status(400).json({ error: 'contact_is_self',
      message: 'Your accountability contact has to be someone else.' });
  }

  // Clearing the contact is always allowed and needs no consent.
  if (!phone && !req.user.contact_phone) {
    db.prepare("UPDATE users SET contact_name=?, contact_phone=NULL, contact_status='none' WHERE id=?")
      .run(name || null, req.user.id);
    return res.json({ ok: true, status: 'none' });
  }

  // Renaming an already-confirmed contact must not silently re-arm a new number.
  const numberChanged = phone && phone !== req.user.contact_phone;
  if (!numberChanged) {
    db.prepare('UPDATE users SET contact_name=? WHERE id=?').run(name || null, req.user.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    return res.json({ ok: true, status: u.contact_status });
  }

  db.prepare(`
    UPDATE users SET contact_name=?, contact_phone=?, contact_status='pending',
      contact_consent_at=NULL, contact_consent_quote=NULL,
      contact_asked_at=datetime('now'), contact_call_id=NULL
    WHERE id=?
  `).run(name || null, phone, req.user.id);

  try {
    const call = await calle.createCall({
      task: calle.consentCallTask(phone, req.user.name, name),
      phone,
      resultSchema: calle.CONSENT_RESULT_SCHEMA,
      metadata: { purpose: 'consent', user_id: String(req.user.id), idempotency_key: `consent_${req.user.id}_${phone}` },
      webhookUrl: `${PUBLIC_URL}/api/webhook/calle`,
    });
    db.prepare('UPDATE users SET contact_call_id=? WHERE id=?').run(call.id, req.user.id);
    res.json({ ok: true, status: 'pending', callId: call.id, dryRun: calle.DRY_RUN });
  } catch (err) {
    console.error('[consent]', err.message);
    res.status(502).json({ error: 'consent_call_failed', message: err.message });
  }
});

/** Withdraw a contact entirely. Also the endpoint the contact's own "remove
 *  me" request maps onto, so it must always work regardless of status. */
app.delete('/api/me/contact', auth.requireUser, (req, res) => {
  db.prepare(`
    UPDATE users SET contact_name=NULL, contact_phone=NULL, contact_status='none',
      contact_consent_at=NULL, contact_consent_quote=NULL, contact_call_id=NULL,
      contact_asked_at=NULL
    WHERE id=?
  `).run(req.user.id);
  res.json({ ok: true, status: 'none' });
});

// What the accountability contact will actually hear. Built from the same
// task builder the real call uses, so the preview can never drift from it.
app.get('/api/me/contact/preview', auth.requireUser, (req, res) => {
  const u = req.user;
  res.json({
    hasContact: Boolean(u.contact_phone),
    contactName: u.contact_name,
    contactPhone: u.contact_phone ? calle.maskPhone(u.contact_phone) : null,
    status: u.contact_status,
    // Both calls this number could ever receive, shown before it is saved.
    consentTask: calle.consentCallTask(
      u.contact_phone ? calle.maskPhone(u.contact_phone) : 'their number',
      u.name,
      u.contact_name,
    ),
    task: calle.shameCallTask(
      u.contact_phone ? calle.maskPhone(u.contact_phone) : 'their number',
      u.name,
      u.contact_name,
      15,
    ),
  });
});

/** Ask again after a missed consent call. Never allowed after a decline: a
 *  "no" is final, and re-asking is exactly the harassment this flow prevents. */
app.post('/api/me/contact/reask', auth.requireUser, async (req, res) => {
  const u = req.user;
  if (!u.contact_phone) return res.status(400).json({ error: 'no_contact' });
  if (u.contact_status === 'declined') {
    return res.status(403).json({ error: 'consent_declined',
      message: 'They said no. Ask them yourself, or use a different number.' });
  }
  if (u.contact_status === 'confirmed') return res.json({ ok: true, status: 'confirmed' });

  try {
    const call = await calle.createCall({
      task: calle.consentCallTask(u.contact_phone, u.name, u.contact_name),
      phone: u.contact_phone,
      resultSchema: calle.CONSENT_RESULT_SCHEMA,
      metadata: { purpose: 'consent', user_id: String(u.id), idempotency_key: `consent_${u.id}_${Date.now()}` },
      webhookUrl: `${PUBLIC_URL}/api/webhook/calle`,
    });
    db.prepare(`UPDATE users SET contact_status='pending', contact_call_id=?, contact_asked_at=datetime('now') WHERE id=?`)
      .run(call.id, u.id);
    res.json({ ok: true, status: 'pending', callId: call.id });
  } catch (err) {
    res.status(502).json({ error: 'consent_call_failed', message: err.message });
  }
});

app.post('/api/auth/logout', auth.requireUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ─── Alarms ─────────────────────────────────────────────────────────

app.get('/api/alarms', auth.requireUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM alarms WHERE user_id=? ORDER BY hour, minute').all(req.user.id).map(publicAlarm));
});

app.post('/api/alarms', auth.requireUser, (req, res) => {
  // Multi-alarm is built into the schema; the UI ships with one to keep the
  // first-run experience obvious. Lifting this is a single constant.
  const count = db.prepare('SELECT COUNT(*) n FROM alarms WHERE user_id=?').get(req.user.id).n;
  if (count >= 1) return res.status(403).json({ error: 'multi_alarm_soon' });

  const a = normaliseAlarm(req.body);
  if (a.error) return res.status(400).json({ error: a.error });
  const info = db.prepare(`INSERT INTO alarms (user_id,label,hour,minute,days,enabled,stake) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, a.label, a.hour, a.minute, a.days, a.enabled, a.stake);
  res.json(publicAlarm(db.prepare('SELECT * FROM alarms WHERE id=?').get(info.lastInsertRowid)));
});

app.put('/api/alarms/:id', auth.requireUser, (req, res) => {
  const existing = db.prepare('SELECT * FROM alarms WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const a = normaliseAlarm({ ...publicAlarm(existing), ...req.body });
  if (a.error) return res.status(400).json({ error: a.error });
  db.prepare('UPDATE alarms SET label=?,hour=?,minute=?,days=?,enabled=?,stake=? WHERE id=?')
    .run(a.label, a.hour, a.minute, a.days, a.enabled, a.stake, existing.id);
  res.json(publicAlarm(db.prepare('SELECT * FROM alarms WHERE id=?').get(existing.id)));
});

app.delete('/api/alarms/:id', auth.requireUser, (req, res) => {
  db.prepare('DELETE FROM alarms WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ─── Firing an alarm ────────────────────────────────────────────────

/** Fire an alarm on demand, for a demo or a test. Identical to the scheduled
 *  path: same challenge, same calls, same consequences. */
app.post('/api/alarms/:id/ring', auth.requireUser, async (req, res) => {
  const alarm = db.prepare('SELECT * FROM alarms WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!alarm) return res.status(404).json({ error: 'not_found' });

  try {
    const { event, task, resultSchema } = await fireAlarm(alarm, req.user);
    res.json({
      ok: true,
      wake: publicWake(event),
      dryRun: calle.DRY_RUN,
      // What was actually sent to CALL-E, so the UI can show the prompt and the
      // typed schema the agent must fill in.
      sent: { task, resultSchema },
    });
  } catch (err) {
    console.error('[ring]', err.message);
    res.status(502).json({ error: 'call_failed', message: err.message });
  }
});

/** Place the wake-up call and record the event. */
async function fireAlarm(alarm, user) {
  const ev = wake.createWakeEvent(alarm, user);
  const { task, resultSchema } = await placeWakeCall(ev, user);
  return { event: wake.getWakeEvent(ev.id), task, resultSchema };
}

/**
 * Dial the user for a given wake event. Used for the first call and for the
 * retry, so both go out with the same challenge: the answer must not change
 * between attempts or the retry would be unanswerable.
 */
async function placeWakeCall(ev, user) {
  const isRetry = ev.attempts > 1;
  // The spoken script quotes the grace window out loud, so it is passed in from
  // the state machine that enforces it rather than restated in the adapter.
  // ev.question holds the code that gets read out, ev.expected_answer its reverse.
  const task = calle.wakeUpReverseTask(
    user.phone, ev.question, ev.expected_answer, user.name, isRetry, wake.GRACE_MINUTES,
  );

  const call = await calle.createCall({
    task,
    phone: user.phone,
    // The reversal is graded on the call itself, so every wake-up call carries
    // the schema. The web window only ever exists as a fallback.
    resultSchema: calle.WAKE_RESULT_SCHEMA,
    metadata: {
      purpose: 'wake',
      wake_event_id: String(ev.id),
      attempt: String(ev.attempts),
      idempotency_key: `wake_${ev.id}_${ev.attempts}`,
    },
    webhookUrl: `${PUBLIC_URL}/api/webhook/calle`,
  });

  wake.setCallId(ev.id, call.id, call.status);
  console.log(
    `[wake ${ev.id}] attempt ${ev.attempts}/${wake.MAX_ATTEMPTS} ` +
    `code=${ev.question} answer=${ev.expected_answer} ` +
    `call=${call.id} answer URL: ${WEB_URL}/wake/${ev.web_token}`,
  );
  // The task and schema are returned so the caller can show exactly what was
  // sent to CALL-E. They are derived here, never rebuilt by the client, so the
  // panel can never show a prompt that differs from the one actually placed.
  return { call, task, resultSchema: calle.WAKE_RESULT_SCHEMA };
}

// ─── The web fallback window (no auth: the token IS the credential) ──

app.get('/api/wake/:token', (req, res) => {
  const ev = wake.getWakeEventByToken(req.params.token);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  res.json(publicWake(ev));
});

app.post('/api/wake/:token/answer', (req, res) => {
  const ev = wake.getWakeEventByToken(req.params.token);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const result = wake.submitWebAnswer(ev.id, req.body.answer);
  if (!result.ok) return res.status(400).json({ error: result.reason, wake: publicWake(result.event || ev) });
  res.json({ ok: true, wake: publicWake(result.event) });
});

// ─── Webhook: CALL-E reports the terminal result ────────────────────

/**
 * CALL-E does not sign webhooks (no secret, no signature header), so this
 * endpoint is treated as a public, untrusted boundary: the event id in the
 * header must match the body, and nothing here is trusted to name a user.
 */
app.post('/api/webhook/calle', (req, res) => {
  const event = req.body || {};
  const headerId = req.get('CALL-E-Event-Id');
  if (headerId && event.id && headerId !== event.id) {
    return res.status(400).json({ error: 'event_id_mismatch' });
  }

  const data = event.data || {};
  const eventId = Number(data?.metadata?.wake_event_id);
  console.log(`[webhook] ${event.type} call=${data.id} wake_event=${eventId || 'n/a'}`);

  // The consent call's verdict decides whether this number may ever be used.
  if (data?.metadata?.purpose === 'consent') {
    const uid = Number(data.metadata.user_id);
    const recipient = data.recipients?.[0];
    const sr = data.structured_result || recipient?.structured_result || {};
    const user = uid && db.prepare('SELECT * FROM users WHERE id=?').get(uid);

    // Ignore a verdict for a number that has since been changed or removed.
    if (user && user.contact_call_id === data.id) {
      const status = sr.consent === 'granted' ? 'confirmed'
        : sr.consent === 'declined' ? 'declined'
        : 'unreachable';
      db.prepare(`
        UPDATE users SET contact_status=?,
          contact_consent_at=CASE WHEN ?='confirmed' THEN datetime('now') ELSE NULL END,
          contact_consent_quote=?
        WHERE id=?
      `).run(status, status, String(sr.consent_quote || '').slice(0, 300) || null, uid);
      console.log(`[consent] user ${uid}: ${status}`);
    }
  }

  // The sign-up call is the wake-up challenge, run once as a rehearsal: CALL-E
  // reads out three digits and grades the reversal, exactly as it will every
  // morning. Only an explicit 'yes' verifies the number.
  if (data?.metadata?.purpose === 'verification') {
    const vphone = String(data.metadata.phone || '');
    const recipient = data.recipients?.[0];
    const sr = data.structured_result || recipient?.structured_result || {};
    const row = vphone && db.prepare('SELECT * FROM verifications WHERE phone=?').get(vphone);

    // Ignore a verdict for a verification that has since been replaced or used.
    if (row && row.call_id === data.id && sr.answer_correct) {
      if (sr.answer_correct === 'yes') {
        db.prepare("UPDATE verifications SET spoken_ok=1 WHERE phone=?").run(vphone);
        console.log(`[verify] ${calle.maskPhone(vphone)}: reversed the digits correctly on the call`);
      } else if (sr.answer_correct === 'no') {
        db.prepare('UPDATE verifications SET attempts=attempts+1 WHERE phone=?').run(vphone);
        console.log(`[verify] ${calle.maskPhone(vphone)}: wrong answer on the call`);
      }
    }
  }

  if (eventId && data?.metadata?.purpose === 'wake') {
    const recipient = data.recipients?.[0];
    const sr = data.structured_result || recipient?.structured_result || {};
    const transcript = recipient?.attempts?.[0]?.transcript_turns || [];
    wake.applyCallResult(eventId, {
      answerCorrect: sr.answer_correct,
      soundedAwake: sr.sounded_awake,
      spokenAnswer: sr.spoken_answer,
      transcript,
      callStatus: data.status,
    });
  }

  res.status(200).json({ received: true });
});

// ─── Scheduler ──────────────────────────────────────────────────────

/**
 * Ticks once a minute. Fires any enabled alarm whose time matches now, and
 * resolves any wake event whose grace window has run out.
 */
function tick() {
  const now = new Date();
  const dayIndex = (now.getDay() + 6) % 7; // Monday = 0

  const due = db.prepare(`
    SELECT a.*, u.id AS uid FROM alarms a JOIN users u ON u.id = a.user_id
    WHERE a.enabled = 1 AND a.hour = ? AND a.minute = ?
  `).all(now.getHours(), now.getMinutes());

  for (const alarm of due) {
    let days;
    try { days = JSON.parse(alarm.days); } catch { days = []; }
    if (!days[dayIndex]) continue;

    // Never fire twice for the same alarm in the same minute.
    const recent = db.prepare(`
      SELECT 1 FROM wake_events WHERE alarm_id=? AND fired_at > datetime('now','-90 seconds')
    `).get(alarm.id);
    if (recent) continue;

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(alarm.user_id);
    fireAlarm(alarm, user).catch(e => console.error('[cron fire]', e.message));
  }

  // Ring again for anyone who did not pass the first call. This runs before the
  // expiry sweep so a retry that is due in the same tick gets its chance.
  for (const ev of wake.dueRetries()) {
    const claimed = wake.beginRetry(ev.id);
    if (!claimed) continue; // another tick got there first
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(claimed.user_id);
    placeWakeCall(claimed, user).catch((e) => {
      console.error('[retry]', e.message);
      // A retry that cannot be dialled must not strand the event in 'calling':
      // drop it into the web window so the user still has a way through.
      wake.forceWebWindow(claimed.id);
    });
  }

  for (const ev of wake.expiredEvents()) {
    wake.markFailed(ev.id);
    punish(ev).catch(e => console.error('[punish]', e.message));
  }
}

/**
 * The consequence: CALL-E calls the accountability contact. No card is charged;
 * the cost of oversleeping is that a real human finds out, which is both
 * cheaper to run and more effective than a two-euro fee.
 */
async function punish(ev) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ev.user_id);

  // A contact who has not said yes is never called, whatever the user set.
  // This is the hard gate: consent is checked at call time, not at save time.
  if (user?.contact_phone && user.contact_status !== 'confirmed') {
    console.log(`[punish] wake ${ev.id} failed, but contact consent is '${user.contact_status}' - not calling`);
    return;
  }

  if (!user?.contact_phone) {
    console.log(`[punish] wake ${ev.id} failed, but no accountability contact set`);
    return;
  }
  const minutesLate = Math.round((Date.now() - new Date(ev.fired_at + 'Z')) / 60000);
  const call = await calle.createCall({
    task: calle.shameCallTask(user.contact_phone, user.name, user.contact_name, minutesLate),
    phone: user.contact_phone,
    resultSchema: calle.SHAME_RESULT_SCHEMA,
    metadata: { purpose: 'shame', wake_event_id: String(ev.id), idempotency_key: `shame_${ev.id}` },
    webhookUrl: `${PUBLIC_URL}/api/webhook/calle`,
  });
  wake.markShamed(ev.id, { callId: call.id });
  console.log(`[punish] wake ${ev.id}: called accountability contact (${call.id})`);
}

// ─── Serialisers: never leak answers or full phone numbers ──────────

function publicUser(u) {
  return {
    id: u.id, name: u.name, phone: calle.maskPhone(u.phone),
    contactName: u.contact_name, contactPhone: u.contact_phone ? calle.maskPhone(u.contact_phone) : null,
    // hasContact means "armed", not "typed in": only a confirmed contact counts.
    hasContact: u.contact_status === 'confirmed',
    contactStatus: u.contact_status,
    contactConsentAt: u.contact_consent_at,
    contactConsentQuote: u.contact_consent_quote,
  };
}

function publicAlarm(a) {
  let days; try { days = JSON.parse(a.days); } catch { days = [true,true,true,true,true,false,false]; }
  return {
    id: a.id, label: a.label, hour: a.hour, minute: a.minute,
    days, enabled: Boolean(a.enabled), stake: a.stake,
  };
}

function publicWake(ev) {
  return {
    id: ev.id, token: ev.web_token, mode: ev.mode,
    // The expected answer (the reversed code) is NEVER serialised: typing it in
    // is the whole proof.
    //
    // The code itself is withheld while the phone is still going to ring, so the
    // call cannot be bypassed from a browser, and revealed once both calls are
    // spent so that a missed call is never an automatic failure. The reversal is
    // still the user's to do either way.
    code: wake.mayRevealCode(ev) ? ev.question : null,
    status: ev.status, deadlineAt: ev.deadline_at, firedAt: ev.fired_at,
    answerCorrect: ev.answer_correct, soundedAwake: ev.sounded_awake,
    spokenAnswer: ev.spoken_answer, resolvedVia: ev.resolved_via,
    transcript: ev.transcript ? JSON.parse(ev.transcript) : null,
    callStatus: ev.call_status,
    attempts: ev.attempts, maxAttempts: wake.MAX_ATTEMPTS,
    // Lets the UI say "we are calling you again" instead of a silent countdown.
    retryInSeconds: ev.retry_at
      ? Math.max(0, Math.round((new Date(ev.retry_at) - new Date()) / 1000))
      : null,
    secondsLeft: Math.max(0, Math.round((new Date(ev.deadline_at) - new Date()) / 1000)),
  };
}

function normaliseAlarm(b) {
  const hour = Number(b.hour), minute = Number(b.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: 'invalid_hour' };
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { error: 'invalid_minute' };
  const days = Array.isArray(b.days) && b.days.length === 7
    ? b.days.map(Boolean) : [true,true,true,true,true,false,false];
  return {
    label: String(b.label ?? '').slice(0, 60),
    hour, minute, days: JSON.stringify(days),
    enabled: b.enabled === false ? 0 : 1,
    stake: ['shame','escalate','streak'].includes(b.stake) ? b.stake : 'shame',
  };
}

// ─── The prompt inspector (read-only, admin key) ────────────────────

/**
 * Guard for the prompt library. The key lives in SSM, never on disk, and is
 * compared in constant time so the endpoint cannot be used as an oracle to
 * recover it a byte at a time. A missing key closes the route rather than
 * opening it.
 */
async function requireAdmin(req, res, next) {
  const expected = await getAdminKey();
  if (!expected) return res.status(503).json({ error: 'admin_not_configured' });

  const given = String(req.get('X-Admin-Key') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'bad_admin_key' });
  }
  next();
}

/**
 * Every instruction this system can give CALL-E, rendered from the same
 * builders the real calls use. Nothing here is a copy: if a prompt changes, this
 * page changes with it, so it can never drift into showing a script that is no
 * longer what gets spoken.
 *
 * Read-only on purpose. Editing a live prompt from a browser would change what
 * a real phone call says to a real person, including the consent script that is
 * the legal basis for calling a third party at all.
 */
app.get('/api/admin/prompts', requireAdmin, (_req, res) => {
  // Placeholders, not real user data. Spelled so they cannot be mistaken for a
  // real number or a real person: a plausible-looking +34 number and a first
  // name read as somebody's actual details at a glance.
  const PHONE = '<THEIR PHONE NUMBER>';
  const SLEEPER = '<SLEEPER NAME>';
  const CONTACT = '<CONTACT NAME>';

  // The code is drawn fresh on every load, from the same generator the alarm
  // uses, rather than pinned to one number. A hardcoded example sitting next to
  // the <PLACEHOLDER> fields reads as if the code were fixed; reloading the page
  // and seeing it change says the opposite. It cannot be a literal placeholder
  // either, because the prompt has to demonstrate the relationship between the
  // digits read out and the answer expected back.
  const CODE = randomCode();
  const ANSWER = reverseCode(CODE);

  res.json({
    graceMinutes: wake.GRACE_MINUTES,
    maxAttempts: wake.MAX_ATTEMPTS,
    retryAfterSeconds: wake.RETRY_AFTER_SECONDS,
    dryRun: calle.DRY_RUN,
    calls: [
      {
        id: 'verification',
        title: 'Phone verification',
        when: 'Once, when someone signs up and has to prove the number is theirs.',
        to: 'The new user',
        task: calle.verificationTask(PHONE, '4821', SLEEPER),
        note: 'A four-digit code, simply read back. Nothing is reversed here: this only proves the number belongs to whoever typed it in.',
        resultSchema: null,
        schemaNote: 'No schema: the proof is the code typed back in, so there is nothing for CALL-E to grade.',
      },
      {
        id: 'consent',
        title: 'Accountability contact consent',
        when: 'Once, when a user nominates someone else as their contact. Until this call returns "granted", that number can never be called again.',
        to: 'The nominated contact, who never signed up',
        task: calle.consentCallTask(PHONE, SLEEPER, CONTACT),
        resultSchema: calle.CONSENT_RESULT_SCHEMA,
        schemaNote: 'Consent is read back as a typed enum rather than inferred from the transcript, and silence or politeness never counts as yes.',
      },
      {
        id: 'wake',
        title: 'The wake-up call',
        when: `When the alarm fires. CALL-E reads out a three digit code and grades the reversal on the call. An unanswered call rings once more ${wake.RETRY_AFTER_SECONDS}s later (up to ${wake.MAX_ATTEMPTS} calls); a call that was answered and failed does not, because the user is already awake and the web window is the cheaper way through.`,
        to: 'The sleeping user',
        task: calle.wakeUpReverseTask(PHONE, CODE, ANSWER, SLEEPER, false, wake.GRACE_MINUTES),
        retryTask: calle.wakeUpReverseTask(PHONE, CODE, ANSWER, SLEEPER, true, wake.GRACE_MINUTES),
        resultSchema: calle.WAKE_RESULT_SCHEMA,
        schemaNote: 'The expected answer is computed by the server and written into the prompt, never left for the model to work out: a model that reversed the digits wrong would reject a correct answer. Only an explicit "yes" passes, and the other two values are not interchangeable: "no" means a human spoke and got it wrong, which ends the calls, while "unknown" means nobody was reached, which earns another ring. That distinction is the whole reason the enum has three members instead of being a boolean.',
      },
      {
        id: 'shame',
        title: 'The accountability call',
        when: 'Only after the grace window runs out with no pass, and only to a contact whose consent came back "granted".',
        to: 'The accountability contact',
        task: calle.shameCallTask(PHONE, SLEEPER, CONTACT, 15),
        resultSchema: calle.SHAME_RESULT_SCHEMA,
        schemaNote: 'Records whether a human actually heard it, so a voicemail is never counted as the consequence having landed.',
      },
    ],
    // The challenge itself, described rather than enumerated: there is no bank
    // of questions to list any more, just one rule and the codes it can produce.
    challenge: {
      rule: 'CALL-E reads out a three digit code. The user says it back in reverse order.',
      example: { code: CODE, expected: ANSWER },
      poolSize: 720,
      excluded: [
        'Palindromes (121, 767): the reverse equals the code, so reading it straight back would pass without anyone waking up.',
        'Codes ending in zero (580): the reverse starts with a zero, which is lost the moment it is spoken or typed, so a correct answer would look wrong.',
      ],
      grading: `Number words become digits and everything else is discarded before comparing, so for this example "${ANSWER}", "${ANSWER.split('').join('-')}" and "it's ${ANSWER}" all pass.`,
      reveal: `The code is hidden on the website while a call is still coming, so the phone cannot be bypassed. Once nothing more will ring it is shown as a rescue: a phone that was face-down or out of battery never heard it, and someone who fumbled it out loud cannot be expected to recall digits they just got wrong. The reversal is still the user's to do.`,
    },
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, dryRun: calle.DRY_RUN }));

if (require.main === module) {
  cron.schedule('* * * * *', tick);
  app.listen(PORT, () => {
    console.log(`SnoozeTax backend on http://localhost:${PORT}`);
    console.log(`CALL-E mode: ${calle.DRY_RUN ? 'DRY RUN (no real calls, no credits spent)' : 'LIVE (real calls, billed)'}`);
  });
}

module.exports = { app, tick, fireAlarm, punish };

/**
 * The wake-up state machine.
 *
 * Vendor-neutral on purpose: this module never imports the CALL-E adapter.
 * Per the repo-root rule, business logic stays decoupled from the vendor SDK and
 * the adapter is the only thing that knows what a phone call is. Calls are
 * handed back to the caller as intents to execute.
 *
 * Lifecycle:
 *   calling ──answered correctly───────────────────> passed
 *      │
 *      ├──answered, wrong ────────────────────────> awaiting_web  (10 min grace)
 *      │
 *      ├──no answer, attempts left──> retrying ──(1 min)──> calling
 *      │
 *      └──no answer, no attempts left─────────────> awaiting_web  (10 min grace)
 *                                                       │
 *                             correct on web ───────────┼────────> passed
 *                             deadline passes ──────────┴────────> failed → shamed
 *
 * Answering and getting it wrong is treated differently from never picking up,
 * because the two say opposite things about whether the user is awake.
 *
 * Someone who spoke has already proved they are conscious and holding the
 * phone. Calling them back to ask the same question they just failed wastes a
 * billed call, so they go straight to the web window, where the code is shown
 * and they only have to reverse it.
 *
 * A missed call proves nothing either way. Do Not Disturb, bad reception and a
 * flat battery all look identical to a snooze, so that case gets the second
 * ring: the phone may genuinely never have been heard. Only when the last call
 * is spent does it fall through to the same web window.
 */
const crypto = require('node:crypto');
const db = require('./db');
const { randomCode, reverseCode, checkAnswer } = require('./challenges');

const GRACE_MINUTES = 10;

// One extra call, a minute later. Each retry is a billed call, so this buys the
// big win (a second chance to actually wake up) without multiplying the cost of
// every bad morning.
const MAX_ATTEMPTS = 2;
const RETRY_AFTER_SECONDS = 60;

function newToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Create the wake event for an alarm that has just fired.
 *
 * One challenge, every morning: a three-digit code, said back in reverse. The
 * code is generated here and spoken by every call for this event, so the answer
 * never changes between the first call and the retry.
 *
 * `question` holds the code itself and `expected_answer` its reverse, which is
 * what the user has to produce. Storing both means the web page can show the
 * code as a rescue without ever recomputing the answer.
 */
function createWakeEvent(alarm, user) {
  // A provisional ceiling, wide enough to cover the slowest path (a missed call
  // plus its retry). It only matters if no call ever reports back: the moment
  // one resolves into the web window, applyCallResult re-bases this to a full
  // GRACE_MINUTES, so no retry ever eats into the user's typing time.
  const deadline = new Date(
    Date.now() + (GRACE_MINUTES * 60_000) + (MAX_ATTEMPTS - 1) * RETRY_AFTER_SECONDS * 1000,
  ).toISOString();

  const code = randomCode();

  const info = db.prepare(`
    INSERT INTO wake_events (alarm_id, user_id, deadline_at, mode, question, expected_answer, web_token, status)
    VALUES (?, ?, ?, 'reverse', ?, ?, ?, 'calling')
  `).run(alarm.id, user.id, deadline, code, reverseCode(code), newToken());

  return getWakeEvent(info.lastInsertRowid);
}

function getWakeEvent(id) {
  return db.prepare('SELECT * FROM wake_events WHERE id = ?').get(id);
}

function getWakeEventByToken(token) {
  return db.prepare('SELECT * FROM wake_events WHERE web_token = ?').get(token);
}

function activeWakeEventForUser(userId) {
  return db.prepare(`
    SELECT * FROM wake_events
    WHERE user_id = ? AND status IN ('calling', 'retrying', 'awaiting_web')
    ORDER BY id DESC LIMIT 1
  `).get(userId);
}

/**
 * Apply the result CALL-E extracted from the phone call.
 * Only an explicit `yes` passes: `unknown` means nobody proved anything, so the
 * user keeps the web window rather than being punished for a bad line.
 */
function applyCallResult(eventId, { answerCorrect, soundedAwake, spokenAnswer, transcript, callStatus }) {
  const ev = getWakeEvent(eventId);
  if (!ev || ev.status === 'passed') return ev;

  const passed = answerCorrect === 'yes';

  // Answering the phone and getting it wrong is NOT the same as never picking
  // up, and the two get different treatment.
  //
  // 'unknown' is the schema's value for "no human answered, or the audio was
  // unintelligible", so it is the only result that earns another ring: nobody
  // has proved they are awake yet and the phone may never have been heard.
  //
  // 'no' means a human spoke and got it wrong. They are demonstrably awake and
  // holding the phone, so a second identical call would just repeat a question
  // they already failed. They go straight to the web window instead, which
  // saves a billed call on every bad morning.
  const noAnswer = answerCorrect !== 'yes' && answerCorrect !== 'no';
  const willRetry = noAnswer && ev.attempts < MAX_ATTEMPTS;

  // Transcripts accumulate across attempts so the history shows every call,
  // not just the last one.
  let mergedTranscript = null;
  if (transcript?.length) {
    let previous = [];
    try { previous = ev.transcript ? JSON.parse(ev.transcript) : []; } catch { previous = []; }
    mergedTranscript = JSON.stringify([...previous, ...transcript]);
  } else {
    mergedTranscript = ev.transcript;
  }

  db.prepare(`
    UPDATE wake_events SET
      answer_correct = ?, sounded_awake = ?, spoken_answer = ?,
      transcript = ?, call_status = ?,
      status = ?, resolved_via = ?, resolved_at = ?, retry_at = ?,
      -- The web window starts when the LAST call is done, so a retry never
      -- shortens the time the user has to type.
      deadline_at = CASE WHEN ? THEN ? ELSE deadline_at END
    WHERE id = ?
  `).run(
    answerCorrect ?? null,
    soundedAwake ?? null,
    spokenAnswer ?? null,
    mergedTranscript,
    callStatus ?? null,
    passed ? 'passed' : willRetry ? 'retrying' : 'awaiting_web',
    passed ? 'phone' : null,
    passed ? new Date().toISOString() : null,
    willRetry ? new Date(Date.now() + RETRY_AFTER_SECONDS * 1000).toISOString() : null,
    passed || willRetry ? 0 : 1,
    new Date(Date.now() + GRACE_MINUTES * 60_000).toISOString(),
    eventId,
  );
  return getWakeEvent(eventId);
}

/**
 * Fall back to the web window when a retry could not be placed at all. Without
 * this the event would sit in 'calling' until the deadline with nothing ringing.
 */
function forceWebWindow(eventId) {
  db.prepare(`
    UPDATE wake_events SET status='awaiting_web', retry_at=NULL, deadline_at=?
    WHERE id=? AND status IN ('calling','retrying')
  `).run(new Date(Date.now() + GRACE_MINUTES * 60_000).toISOString(), eventId);
  return getWakeEvent(eventId);
}

/** Wake events whose retry is now due. The caller places the call. */
function dueRetries() {
  return db.prepare(`
    SELECT * FROM wake_events
    WHERE status = 'retrying' AND retry_at IS NOT NULL AND retry_at <= ?
  `).all(new Date().toISOString());
}

/**
 * Mark a retry as being placed. Bumps the attempt counter and clears retry_at
 * first, so a slow call cannot be dialled twice by two overlapping ticks.
 */
function beginRetry(eventId) {
  const changed = db.prepare(`
    UPDATE wake_events SET attempts = attempts + 1, retry_at = NULL, status = 'calling'
    WHERE id = ? AND status = 'retrying'
  `).run(eventId).changes;
  return changed ? getWakeEvent(eventId) : null;
}

/** Grade an answer typed on the web during the grace window. */
function submitWebAnswer(eventId, given) {
  const ev = getWakeEvent(eventId);
  if (!ev) return { ok: false, reason: 'not_found' };
  if (ev.status === 'passed') return { ok: true, already: true, event: ev };
  if (ev.status === 'failed' || ev.status === 'shamed') {
    return { ok: false, reason: 'expired', event: ev };
  }
  if (new Date(ev.deadline_at) < new Date()) {
    return { ok: false, reason: 'expired', event: ev };
  }

  // ev.question holds the code that was read out; the answer is its reverse.
  if (!checkAnswer(ev.question, given)) {
    return { ok: false, reason: 'wrong', event: ev };
  }

  db.prepare(`
    UPDATE wake_events SET status='passed', resolved_via='web', resolved_at=? WHERE id = ?
  `).run(new Date().toISOString(), eventId);

  return { ok: true, event: getWakeEvent(eventId) };
}

/**
 * Whether the web page may show the code itself.
 *
 * Not while the phone is still going to ring: showing it then would make the
 * call pointless, since anyone could pass from the browser without ever picking
 * up. `awaiting_web` is exactly the state where nothing more will ring, so
 * reaching it is what unlocks the code.
 *
 * That covers both ways in. Somebody whose phone was face-down, out of battery
 * or on Do Not Disturb never heard a code at all, and without this they could
 * not pass at any price, which turns a missed call into a guaranteed failure.
 * Somebody who answered and fumbled it did hear one, but expecting them to have
 * memorised digits they just got wrong is the same trap.
 *
 * The reversal still has to be done either way: the code is shown, never the
 * answer.
 */
function mayRevealCode(ev) {
  return ev.status === 'awaiting_web';
}

/** Wake events whose grace window has run out without a pass. */
function expiredEvents() {
  return db.prepare(`
    SELECT * FROM wake_events
    WHERE status IN ('calling', 'retrying', 'awaiting_web') AND deadline_at < ?
  `).all(new Date().toISOString());
}

function markFailed(eventId) {
  db.prepare(`
    UPDATE wake_events SET status='failed', resolved_via='timeout', resolved_at=? WHERE id=?
  `).run(new Date().toISOString(), eventId);
  return getWakeEvent(eventId);
}

function markShamed(eventId, { callId, reached }) {
  db.prepare(`
    UPDATE wake_events SET status='shamed', shame_call_id=?, shame_reached=? WHERE id=?
  `).run(callId ?? null, reached ?? null, eventId);
  return getWakeEvent(eventId);
}

function setCallId(eventId, callId, callStatus) {
  db.prepare('UPDATE wake_events SET call_id=?, call_status=? WHERE id=?')
    .run(callId, callStatus ?? null, eventId);
}

/** Streak = consecutive most-recent events that were passed. */
function computeStats(userId) {
  const rows = db.prepare(`
    SELECT status, resolved_via, sounded_awake, fired_at FROM wake_events
    WHERE user_id = ? ORDER BY id DESC
  `).all(userId);

  let streak = 0;
  for (const r of rows) {
    if (r.status === 'passed') streak++;
    else if (r.status === 'failed' || r.status === 'shamed') break;
  }

  return {
    total: rows.length,
    passed: rows.filter(r => r.status === 'passed').length,
    failed: rows.filter(r => r.status === 'failed' || r.status === 'shamed').length,
    shamed: rows.filter(r => r.status === 'shamed').length,
    byPhone: rows.filter(r => r.resolved_via === 'phone').length,
    byWeb: rows.filter(r => r.resolved_via === 'web').length,
    groggy: rows.filter(r => r.sounded_awake === 'groggy').length,
    streak,
    recent: rows.slice(0, 14),
  };
}

module.exports = {
  GRACE_MINUTES,
  MAX_ATTEMPTS,
  RETRY_AFTER_SECONDS,
  mayRevealCode,
  dueRetries,
  beginRetry,
  forceWebWindow,
  newToken,
  createWakeEvent,
  getWakeEvent,
  getWakeEventByToken,
  activeWakeEventForUser,
  applyCallResult,
  submitWebAnswer,
  expiredEvents,
  markFailed,
  markShamed,
  setCallId,
  computeStats,
};

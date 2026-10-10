/**
 * Session auth.
 *
 * Deliberately long-lived (180 days). An alarm clock lives on one phone, and
 * CALL-E has no SMS, so re-entry cannot rely on a magic link. Making the user
 * re-verify by phone every morning would mean burning a paid call just to read
 * your own alarms. The session simply persists; a verification call is the
 * recovery path for a new device, not the daily path.
 */
const db = require('./db');
const crypto = require('node:crypto');

const SESSION_DAYS = 180;
const COOKIE = 'snoozetax_session';

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return { token, expires };
}

function userForToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

function readToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const raw = req.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Attaches req.user when a valid session exists. Never throws. */
function attachUser(req, _res, next) {
  req.user = userForToken(readToken(req));
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

module.exports = { createSession, userForToken, attachUser, requireUser, COOKIE, SESSION_DAYS };

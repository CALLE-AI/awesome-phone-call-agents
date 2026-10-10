/**
 * SQLite persistence. Alarms and wake events must survive a restart: an alarm
 * clock that forgets its alarms when the process bounces is not an alarm clock.
 */
const Database = require('better-sqlite3');
const path = require('node:path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'snoozetax.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL UNIQUE,
  contact_name   TEXT,
  contact_phone  TEXT,
  -- A nominated contact is a third party who never signed up. They are only
  -- called once they have said yes out loud on a consent call, and the exact
  -- words they used are kept as the record of that consent.
  contact_status TEXT NOT NULL DEFAULT 'none',
  -- none | pending | confirmed | declined | unreachable
  contact_consent_at    TEXT,
  contact_consent_quote TEXT,
  contact_call_id       TEXT,
  contact_asked_at      TEXT,
  timezone       TEXT DEFAULT 'Europe/Madrid',
  verified_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  phone       TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT,
  call_id     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  spoken_ok   INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alarms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  hour        INTEGER NOT NULL,
  minute      INTEGER NOT NULL,
  days        TEXT NOT NULL DEFAULT '[true,true,true,true,true,false,false]',
  enabled     INTEGER NOT NULL DEFAULT 1,
  stake       TEXT NOT NULL DEFAULT 'shame',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per time the alarm actually fired. This is the state machine that
-- decides whether the user woke up, and it is also the demo's audit trail.
CREATE TABLE IF NOT EXISTS wake_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  alarm_id         INTEGER NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fired_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deadline_at      TEXT NOT NULL,
  mode             TEXT NOT NULL,              -- 'question' | 'code'
  question         TEXT,
  expected_answer  TEXT,
  web_token        TEXT NOT NULL,              -- unguessable, auth-free answer URL
  status           TEXT NOT NULL DEFAULT 'calling',
  -- calling | awaiting_web | passed | failed | shamed
  call_id          TEXT,
  call_status      TEXT,
  answer_correct   TEXT,
  sounded_awake    TEXT,
  spoken_answer    TEXT,
  transcript       TEXT,
  resolved_via     TEXT,                       -- 'phone' | 'web' | 'timeout'
  resolved_at      TEXT,
  shame_call_id    TEXT,
  shame_reached    TEXT,
  -- How many wake-up calls this event has placed (1 = the original).
  attempts         INTEGER NOT NULL DEFAULT 1,
  -- When the next retry becomes due; NULL once no retry is pending.
  retry_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_wake_token  ON wake_events(web_token);
CREATE INDEX IF NOT EXISTS idx_wake_status ON wake_events(status);
CREATE INDEX IF NOT EXISTS idx_alarm_user  ON alarms(user_id);
CREATE INDEX IF NOT EXISTS idx_sess_user   ON sessions(user_id);
`);

/**
 * Additive migrations for databases created before a column existed.
 * CREATE TABLE IF NOT EXISTS never alters an existing table, so a checkout
 * that has already run the app would otherwise be missing these.
 */
const wakeColumns = new Set(db.prepare('PRAGMA table_info(wake_events)').all().map(c => c.name));
for (const [name, decl] of [['attempts', 'INTEGER NOT NULL DEFAULT 1'], ['retry_at', 'TEXT']]) {
  if (!wakeColumns.has(name)) {
    db.exec(`ALTER TABLE wake_events ADD COLUMN ${name} ${decl}`);
    console.log(`[db] migrated: wake_events.${name}`);
  }
}

// Set when the sign-up call heard the right code read back, which lets the user
// in without typing anything. The typed field stays as the fallback for a call
// that never connected.
const verifyColumns = new Set(db.prepare('PRAGMA table_info(verifications)').all().map(c => c.name));
if (!verifyColumns.has('spoken_ok')) {
  db.exec('ALTER TABLE verifications ADD COLUMN spoken_ok INTEGER NOT NULL DEFAULT 0');
  console.log('[db] migrated: verifications.spoken_ok');
}

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
const ADDITIONS = [
  ['contact_status', "TEXT NOT NULL DEFAULT 'none'"],
  ['contact_consent_at', 'TEXT'],
  ['contact_consent_quote', 'TEXT'],
  ['contact_call_id', 'TEXT'],
  ['contact_asked_at', 'TEXT'],
];
for (const [name, decl] of ADDITIONS) {
  if (!userColumns.has(name)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${decl}`);
    console.log(`[db] migrated: users.${name}`);
  }
}

// Any contact that predates the consent flow has never been asked, so it must
// not be called until it is. Treat an existing number as pending, not granted.
db.exec(`
  UPDATE users SET contact_status='pending'
  WHERE contact_phone IS NOT NULL AND contact_status='none'
`);

module.exports = db;

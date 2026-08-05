/**
 * call-lock.js
 *
 * Durable, file-based dispatch protection: refuses to place a duplicate call
 * to the same recipient for the same purpose, even across separate process
 * invocations (a retry after a crash or timeout must see the same lock a
 * first attempt would have written).
 *
 * This is deliberately simple -- one JSON file per (phone, purpose) key under
 * skills/accesscall/.call-locks/ (gitignored; runtime state, not source) --
 * rather than a real distributed lock. It's a local safeguard for a
 * single-operator CLI workflow, not a concurrency primitive for many
 * simultaneous processes across machines.
 *
 * CONCURRENCY: acquireLock() uses an atomic exclusive-create write
 * (`{ flag: "wx" }`), which fails with EEXIST if the file already exists.
 * This is a single syscall, not a separate existence-check followed by a
 * write -- there is no window between "check" and "act" for two concurrent
 * processes to both observe "unlocked" and both proceed. An earlier version
 * of this file checked-then-wrote as two steps, which was racy; do not
 * reintroduce that pattern.
 *
 * RELEASE: a lock is released only by releaseLock() being called with a
 * confirmed terminal call status (COMPLETED, FAILED, NO_ANSWER, DECLINED,
 * CANCELED, CANCELLED, VOICEMAIL, BUSY, EXPIRED -- i.e. get_call_run actually
 * returned one of these), never by a timer. If a prior dispatch's status
 * genuinely can't be determined (e.g. the process that would have called
 * releaseLock crashed first), the lock stays held indefinitely; clearing it
 * requires an explicit `override`, which is a deliberate, visible decision,
 * not a silent timeout.
 *
 * The lock file stores the phone number *masked* (via phone-utils.js's
 * maskPhone), not raw, so a lock directory listing never itself becomes a
 * place where full phone numbers sit in plaintext on disk. The lock *key* is
 * a hash of the raw phone + purpose (needed so lookups still work), not the
 * masked value.
 *
 * Usage:
 *   node call-lock.js --check --phone <E.164> --purpose <string>
 *   node call-lock.js --acquire --phone <E.164> --purpose <string> [--override] [--run-id <id>]
 *   node call-lock.js --release --phone <E.164> --purpose <string> --terminal-status <STATUS>
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { assertE164, maskPhone } = require("./phone-utils.js");

const LOCK_DIR = path.join(__dirname, "..", ".call-locks");

// The only statuses get_call_run can return that mean "this call run is
// truly over, no further ambiguity" -- matches the terminal-status vocabulary
// already established for this skill's CALL-E workflow.
const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "VOICEMAIL",
  "BUSY",
  "EXPIRED",
]);

function lockKey(phone, purpose) {
  return crypto.createHash("sha256").update(`${phone}|${purpose}`).digest("hex");
}

function lockPathFor(phone, purpose) {
  return path.join(LOCK_DIR, `${lockKey(phone, purpose)}.json`);
}

function readLockFile(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    // A corrupted lock file must not silently be treated as "no lock" --
    // that would defeat the whole point. Report it as present-but-unreadable
    // so callers are forced to investigate (or override) rather than
    // dispatch as if nothing were there.
    return { corrupted: true };
  }
}

function requirePhoneAndPurpose(phone, purpose) {
  assertE164(phone);
  if (!purpose) throw new Error('A "purpose" string is required.');
}

/**
 * Read-only status check: is a lock currently present for this (phone,
 * purpose)? Existence alone means locked -- there is no time-based expiry.
 */
function checkLock({ phone, purpose }) {
  requirePhoneAndPurpose(phone, purpose);
  const lockPath = lockPathFor(phone, purpose);
  const existing = readLockFile(lockPath);
  return { locked: existing !== null, lockPath, existing };
}

/**
 * Acquires the dispatch lock via an atomic exclusive-create write, throwing
 * if one is already held and `override` was not explicitly passed. Call this
 * immediately before `run_call` -- never after, since the whole point is to
 * prevent a duplicate dispatch, including on a retry after a crash between
 * acquiring and actually placing the call (that retry will see this same
 * lock and refuse).
 *
 * `override` bypasses the atomic check entirely and force-writes -- it is an
 * explicit, human-confirmed bypass, not a concurrency-safe path, and should
 * only be reached after the user has explicitly confirmed they want to place
 * another call despite the existing lock.
 */
function acquireLock({ phone, purpose, override = false, meta = {} }) {
  requirePhoneAndPurpose(phone, purpose);
  const lockPath = lockPathFor(phone, purpose);
  const record = {
    maskedPhone: maskPhone(phone),
    purpose,
    dispatchedAt: new Date().toISOString(),
    ...meta,
  };
  const data = JSON.stringify(record, null, 2);

  fs.mkdirSync(LOCK_DIR, { recursive: true });

  if (override) {
    fs.writeFileSync(lockPath, data);
    return record;
  }

  try {
    fs.writeFileSync(lockPath, data, { flag: "wx" });
    return record;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = readLockFile(lockPath);
    const when =
      existing && !existing.corrupted && existing.dispatchedAt
        ? existing.dispatchedAt
        : "an unknown time (lock file is corrupted and cannot be dated)";
    throw new Error(
      `Refusing duplicate dispatch: a call for ${maskPhone(phone)} (purpose "${purpose}") is still locked ` +
        `(dispatched at ${when}). It has not been released because no confirmed terminal status has been ` +
        "recorded for it yet -- call releaseLock() once get_call_run returns one, or ask the user to " +
        "explicitly confirm an override before retrying.",
    );
  }
}

/**
 * Releases the dispatch lock. Requires a confirmed terminal status from
 * get_call_run -- this must never be called speculatively or on a timer.
 */
function releaseLock({ phone, purpose, terminalStatus }) {
  requirePhoneAndPurpose(phone, purpose);
  const status = String(terminalStatus || "").toUpperCase();
  if (!TERMINAL_STATUSES.has(status)) {
    throw new Error(
      `releaseLock requires a confirmed terminal status (one of: ${[...TERMINAL_STATUSES].join(", ")}); ` +
        `got ${JSON.stringify(terminalStatus)}. Do not release the lock while a call may still be in progress.`,
    );
  }
  const lockPath = lockPathFor(phone, purpose);
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  return { released: true, lockPath, terminalStatus: status };
}

module.exports = {
  TERMINAL_STATUSES,
  LOCK_DIR,
  lockPathFor,
  checkLock,
  acquireLock,
  releaseLock,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.phone || !args.purpose) {
    console.error(
      "Usage: node call-lock.js --check|--acquire|--release --phone <E.164> --purpose <string> " +
        "[--override] [--run-id <id>] [--terminal-status <STATUS>]",
    );
    process.exitCode = 1;
    return;
  }

  try {
    if (args.check) {
      const status = checkLock({ phone: args.phone, purpose: args.purpose });
      console.log(JSON.stringify(status, null, 2));
      if (status.locked) process.exitCode = 1;
      return;
    }
    if (args.acquire) {
      const record = acquireLock({
        phone: args.phone,
        purpose: args.purpose,
        override: Boolean(args.override),
        meta: args["run-id"] ? { runId: args["run-id"] } : {},
      });
      console.log(JSON.stringify(record, null, 2));
      return;
    }
    if (args.release) {
      const result = releaseLock({
        phone: args.phone,
        purpose: args.purpose,
        terminalStatus: args["terminal-status"],
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.error("Specify --check, --acquire, or --release.");
    process.exitCode = 1;
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

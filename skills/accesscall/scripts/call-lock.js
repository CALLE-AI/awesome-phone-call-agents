/**
 * call-lock.js
 *
 * Durable, file-based dispatch protection: refuses to place a duplicate call
 * to the same recipient for the same purpose within a time window, even
 * across separate process invocations (a retry after a crash or timeout must
 * see the same lock a first attempt would have written).
 *
 * This is deliberately simple -- one JSON file per (phone, purpose) key under
 * skills/accesscall/.call-locks/ (gitignored; runtime state, not source) --
 * rather than a real distributed lock. It's a local safeguard for a
 * single-operator CLI workflow, not a concurrency primitive for multiple
 * simultaneous processes.
 *
 * The lock file stores the phone number *masked* (via phone-utils.js's
 * maskPhone), not raw, so a lock directory listing never itself becomes a
 * place where full phone numbers sit in plaintext on disk. The lock *key* is
 * a hash of the raw phone + purpose (needed so lookups still work), not the
 * masked value.
 *
 * Usage:
 *   node call-lock.js --check --phone <E.164> --purpose <string> [--window-minutes 10]
 *   node call-lock.js --acquire --phone <E.164> --purpose <string> [--window-minutes 10] [--override] [--run-id <id>]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { assertE164, maskPhone } = require("./phone-utils.js");

const DEFAULT_WINDOW_MINUTES = 10;
const LOCK_DIR = path.join(__dirname, "..", ".call-locks");

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
    // that would defeat the whole point. Treat it as an active, un-datable
    // lock so callers are forced to investigate rather than dispatch.
    return { corrupted: true };
  }
}

/**
 * Checks whether a call for this (phone, purpose) is currently locked --
 * i.e. one was dispatched within the last `windowMinutes` minutes (or the
 * existing lock file is corrupted and can't be dated at all).
 */
function checkLock({ phone, purpose, windowMinutes = DEFAULT_WINDOW_MINUTES }) {
  assertE164(phone);
  if (!purpose) throw new Error('checkLock requires a "purpose" string.');

  const lockPath = lockPathFor(phone, purpose);
  const existing = readLockFile(lockPath);

  if (!existing) {
    return { locked: false, lockPath, existing: null };
  }
  if (existing.corrupted) {
    return { locked: true, lockPath, existing, reason: "Lock file is corrupted and cannot be dated safely." };
  }

  const dispatchedAt = new Date(existing.dispatchedAt);
  const minutesAgo = (Date.now() - dispatchedAt.getTime()) / 60000;
  const locked = minutesAgo >= 0 && minutesAgo < windowMinutes;

  return { locked, lockPath, existing, minutesAgo };
}

/**
 * Acquires the dispatch lock, throwing if one is already active and
 * `override` was not explicitly passed. Call this immediately before
 * `run_call` -- never after, since the whole point is to prevent a duplicate
 * dispatch, including on a retry after a crash between acquiring and
 * actually placing the call (that retry will see this same lock and refuse).
 */
function acquireLock({ phone, purpose, windowMinutes = DEFAULT_WINDOW_MINUTES, override = false, meta = {} }) {
  const status = checkLock({ phone, purpose, windowMinutes });

  if (status.locked && !override) {
    const when = status.existing && status.existing.dispatchedAt ? status.existing.dispatchedAt : "an unknown time";
    throw new Error(
      `Refusing duplicate dispatch: a call for ${maskPhone(phone)} (purpose "${purpose}") was already ` +
        `dispatched at ${when}, within the ${windowMinutes}-minute window. ` +
        "Ask the user to explicitly confirm they want to place another call before overriding.",
    );
  }

  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const record = {
    maskedPhone: maskPhone(phone),
    purpose,
    dispatchedAt: new Date().toISOString(),
    windowMinutes,
    ...meta,
  };
  fs.writeFileSync(status.lockPath, JSON.stringify(record, null, 2));
  return record;
}

module.exports = {
  DEFAULT_WINDOW_MINUTES,
  LOCK_DIR,
  lockPathFor,
  checkLock,
  acquireLock,
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
  const windowMinutes = args["window-minutes"] !== undefined ? parseFloat(args["window-minutes"]) : DEFAULT_WINDOW_MINUTES;

  if (!args.phone || !args.purpose) {
    console.error(
      "Usage: node call-lock.js --check|--acquire --phone <E.164> --purpose <string> " +
        "[--window-minutes 10] [--override] [--run-id <id>]",
    );
    process.exitCode = 1;
    return;
  }

  try {
    if (args.check) {
      const status = checkLock({ phone: args.phone, purpose: args.purpose, windowMinutes });
      console.log(JSON.stringify(status, null, 2));
      if (status.locked) process.exitCode = 1;
      return;
    }
    if (args.acquire) {
      const record = acquireLock({
        phone: args.phone,
        purpose: args.purpose,
        windowMinutes,
        override: Boolean(args.override),
        meta: args["run-id"] ? { runId: args["run-id"] } : {},
      });
      console.log(JSON.stringify(record, null, 2));
      return;
    }
    console.error("Specify --check or --acquire.");
    process.exitCode = 1;
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

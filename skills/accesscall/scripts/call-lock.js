/**
 * call-lock.js
 *
 * Durable, file-based dispatch protection: refuses to place a duplicate call
 * to the same recipient for the same purpose, even across separate process
 * invocations (a retry after a crash or timeout must see the same lock a
 * first attempt would have written).
 *
 * This is deliberately simple -- files under skills/accesscall/.call-locks/
 * (gitignored; runtime state, not source) -- rather than a real distributed
 * lock. It's a local safeguard for a single-operator CLI workflow, not a
 * concurrency primitive for many simultaneous processes across machines.
 *
 * OWNERSHIP: every lock is owned by the `plan_id` that acquired it (required
 * on both acquireLock and releaseLock -- there is no ownerless lock).
 * releaseLock is compare-and-delete: it only releases the lock if the
 * `plan_id` it's given matches the `plan_id` currently stored in the lock
 * file. If a lock has been overridden by a different dispatch since this
 * caller acquired it, the stored `plan_id` will no longer match, and release
 * is refused rather than silently deleting (or worse, freeing) a lock this
 * caller no longer owns. Concretely, this is what prevents: run A acquires,
 * run B explicitly overrides (B now owns it), a late/delayed terminal result
 * for A arrives and calls releaseLock -- without the compare, that unlinks
 * the file unconditionally and frees B's still-active lock for a third
 * dispatch. With the compare, A's `plan_id` no longer matches B's, so release
 * is refused and B's lock survives untouched.
 *
 * DISPATCH HISTORY: deleting the lock file on release is necessary (so a new
 * dispatch to the same recipient can proceed) but it would also destroy the
 * only record that a given `plan_id` was ever dispatched at all -- a crash
 * between release and whatever downstream bookkeeping marks the call as
 * "done" could let the same `plan_id` be replayed. So a *separate*,
 * append-only journal under skills/accesscall/.call-locks/history/ records
 * every dispatch and its eventual outcome, and this file is never deleted by
 * releaseLock (or anything else in this module). acquireLock checks this
 * journal before granting a new lock and refuses to dispatch a `plan_id`
 * that has already been dispatched before, regardless of whether a lock is
 * currently held for that recipient -- this check is NOT bypassed by
 * `override`, since override is for "let me call this recipient again
 * despite an existing lock" (which should come with a fresh `plan_id` from a
 * new plan_call), not "let me replay an already-used plan_id."
 *
 * FAIL-CLOSED ON CORRUPTION: if the journal has an unparseable line (e.g.
 * torn by a crash mid-write), readHistory() throws rather than silently
 * skipping that line. A skipped line could be the only record that a given
 * `plan_id` was already dispatched -- silently ignoring it would make a
 * previously-dispatched `plan_id` look never-dispatched, permitting exactly
 * the replay this journal exists to prevent. The same applies to a corrupted
 * lock *file* (see readLockFile): unreadable state is never treated as
 * "nothing to worry about."
 *
 * CONCURRENCY: every lock mutation -- a fresh acquire, an override, or a
 * release -- runs inside a per-(phone,purpose) mutex (see withMutex), held
 * for the *entire* read-current-state -> decide -> write critical section.
 * The mutex itself is acquired via the same atomic exclusive-create-write
 * primitive (`{ flag: "wx" }`, retried with backoff until it succeeds or
 * times out) used previously for just the fresh-acquire lock file -- but
 * `wx` alone cannot protect override, since override's whole point is to
 * replace a file that already exists, and `wx` fails whenever the file
 * exists. Wrapping the *whole* critical section in a separate mutex file
 * protects fresh-acquire, override, and release uniformly: only one process
 * at a time can be inside "read the current lock, decide what to do, write
 * the result" for a given (phone, purpose), so two concurrent overrides
 * cannot both observe "someone else holds it," both decide to proceed, and
 * both write.
 *
 * The lock file stores the phone number *masked* (via phone-utils.js's
 * maskPhone), not raw, so a lock directory listing never itself becomes a
 * place where full phone numbers sit in plaintext on disk. The lock/history
 * *key* is a hash of the raw phone + purpose (needed so lookups still work),
 * not the masked value.
 *
 * Usage:
 *   node call-lock.js --check --phone <E.164> --purpose <string>
 *   node call-lock.js --acquire --phone <E.164> --purpose <string> --plan-id <id> [--override] [--run-id <id>]
 *   node call-lock.js --release --phone <E.164> --purpose <string> --plan-id <id> --terminal-status <STATUS>
 *   node call-lock.js --history-check --phone <E.164> --purpose <string> --plan-id <id>
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { assertE164, maskPhone } = require("./phone-utils.js");

const LOCK_DIR = path.join(__dirname, "..", ".call-locks");
const HISTORY_DIR = path.join(LOCK_DIR, "history");

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

// Mutex retry tuning: the critical section it guards is a handful of
// synchronous fs calls (microseconds to low milliseconds), so this budget is
// generous relative to expected hold times. A stuck mutex (e.g. a process
// that crashed while holding it) is deliberately NOT auto-broken by a
// timeout guess -- see the "no blind timers" precedent elsewhere in this
// skill (call locks themselves don't auto-expire either); it times out with
// a clear error instead, requiring a human to look at why it's stuck.
const MUTEX_RETRY_ATTEMPTS = 300;
const MUTEX_RETRY_DELAY_MS = 2;

function lockKey(phone, purpose) {
  return crypto.createHash("sha256").update(`${phone}|${purpose}`).digest("hex");
}

function lockPathFor(phone, purpose) {
  return path.join(LOCK_DIR, `${lockKey(phone, purpose)}.json`);
}

function historyPathFor(phone, purpose) {
  return path.join(HISTORY_DIR, `${lockKey(phone, purpose)}.jsonl`);
}

function mutexPathFor(phone, purpose) {
  return path.join(LOCK_DIR, `${lockKey(phone, purpose)}.mutex`);
}

function readLockFile(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    // A corrupted lock file must not silently be treated as "no lock" --
    // that would defeat the whole point. Report it as present-but-unreadable
    // so callers are forced to investigate (or override) rather than
    // dispatch, or release, as if nothing were there.
    return { corrupted: true };
  }
}

// Append-only by construction: every call is a single fs.appendFileSync, and
// nothing in this module ever opens the history file for writing/truncation.
function appendHistory(phone, purpose, record) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.appendFileSync(historyPathFor(phone, purpose), `${JSON.stringify(record)}\n`);
}

// Fails closed: throws on the first unparseable line rather than skipping
// it. A silently-skipped line could be the only record of a prior dispatch,
// which would make a previously-dispatched plan_id look never-dispatched --
// exactly the replay this journal exists to prevent. Callers (hasBeenDispatched,
// and therefore acquireLock) let this propagate rather than catching it.
function readHistory(phone, purpose) {
  const historyPath = historyPathFor(phone, purpose);
  if (!fs.existsSync(historyPath)) return [];
  const lines = fs
    .readFileSync(historyPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(
        `Dispatch history journal is corrupted: ${historyPath} (line ${index + 1}) failed to parse ` +
          `(${err.message}). Refusing to determine dispatch history from a corrupted journal -- this could ` +
          "hide a real prior dispatch and permit a replay. Fix or restore the journal manually before any " +
          "new dispatch is attempted for this phone+purpose.",
      );
    }
  });
}

function requireFields({ phone, purpose, planId }, { needPlanId = true } = {}) {
  assertE164(phone);
  if (!purpose) throw new Error('A "purpose" string is required.');
  if (needPlanId && !planId) throw new Error('A "planId" is required.');
}

/**
 * True if this exact `planId` has ever been dispatched for this (phone,
 * purpose), regardless of whether that dispatch's lock has since been
 * released. A `plan_id` must never be replayed. Throws (does not return
 * false) if the journal can't be fully read -- see readHistory.
 */
function hasBeenDispatched({ phone, purpose, planId }) {
  requireFields({ phone, purpose, planId });
  return readHistory(phone, purpose).some((record) => record.event === "dispatched" && record.planId === planId);
}

/**
 * Read-only status check: is a lock currently present for this (phone,
 * purpose)? Existence alone means locked -- there is no time-based expiry.
 */
function checkLock({ phone, purpose }) {
  requireFields({ phone, purpose }, { needPlanId: false });
  const lockPath = lockPathFor(phone, purpose);
  const existing = readLockFile(lockPath);
  return { locked: existing !== null, lockPath, existing };
}

function sleepSync(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    /* deliberate short busy-wait; see MUTEX_RETRY_ATTEMPTS comment above */
  }
}

/**
 * Acquires the per-(phone,purpose) mutex file via atomic exclusive-create,
 * retrying with a short backoff until it succeeds or the retry budget is
 * exhausted. Returns the mutex path (pass to releaseMutex).
 */
function acquireMutex(phone, purpose) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const mutexPath = mutexPathFor(phone, purpose);
  for (let attempt = 0; attempt <= MUTEX_RETRY_ATTEMPTS; attempt++) {
    try {
      fs.writeFileSync(mutexPath, String(process.pid), { flag: "wx" });
      return mutexPath;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (attempt === MUTEX_RETRY_ATTEMPTS) {
        throw new Error(
          `Timed out waiting for the dispatch-lock mutex (${mutexPath}). Another process may be stuck holding ` +
            "it (e.g. crashed mid-critical-section) -- this is not auto-recovered; remove the mutex file " +
            "manually only after confirming no other process is actually using it.",
        );
      }
      sleepSync(MUTEX_RETRY_DELAY_MS);
    }
  }
  // Unreachable, but keeps control-flow analysis happy.
  throw new Error("acquireMutex: exhausted retries without acquiring or throwing.");
}

function releaseMutex(mutexPath) {
  try {
    fs.unlinkSync(mutexPath);
  } catch {
    // Best-effort: if it's already gone there's nothing to clean up.
  }
}

/**
 * Runs `fn` with the per-(phone,purpose) mutex held for its entire duration,
 * releasing it even if `fn` throws. Every lock mutation (acquire, override,
 * release) goes through this so they're all serialized against each other,
 * not just fresh-acquire against fresh-acquire.
 */
function withMutex(phone, purpose, fn) {
  const mutexPath = acquireMutex(phone, purpose);
  try {
    return fn();
  } finally {
    releaseMutex(mutexPath);
  }
}

/**
 * Acquires the dispatch lock for `planId`, throwing if one is already held
 * by a *different* `planId` and `override` was not explicitly passed.
 * Refuses unconditionally (even with `override`) if this exact `planId` was
 * already dispatched before, per the durable history journal.
 *
 * Call this immediately before `run_call` -- never after, since the whole
 * point is to prevent a duplicate dispatch, including on a retry after a
 * crash between acquiring and actually placing the call.
 *
 * `override` bypasses the active-lock conflict check and replaces the
 * existing lock file -- it is an explicit, human-confirmed bypass for "call
 * this recipient again despite an existing lock," not a way around the
 * dispatch-history replay check. The whole read-decide-write sequence below
 * runs inside the per-(phone,purpose) mutex (see withMutex), so this is safe
 * against concurrent acquireLock calls regardless of whether they're
 * fresh-acquires, overrides, or a mix of both.
 */
function acquireLock({ phone, purpose, planId, override = false, meta = {} }) {
  requireFields({ phone, purpose, planId });

  return withMutex(phone, purpose, () => {
    if (hasBeenDispatched({ phone, purpose, planId })) {
      throw new Error(
        `Refusing to dispatch: plan_id ${JSON.stringify(planId)} for ${maskPhone(phone)} (purpose "${purpose}") ` +
          "was already dispatched before, per the durable dispatch history -- a plan_id must never be replayed, " +
          "even after its lock has been released, and even with an override. Get a new plan_id from plan_call " +
          "for another attempt.",
      );
    }

    const lockPath = lockPathFor(phone, purpose);
    const existing = readLockFile(lockPath);

    if (existing !== null && !override) {
      const when =
        !existing.corrupted && existing.dispatchedAt
          ? existing.dispatchedAt
          : "an unknown time (lock file is corrupted and cannot be dated)";
      const heldBy = !existing.corrupted && existing.planId ? ` by plan_id ${JSON.stringify(existing.planId)}` : "";
      throw new Error(
        `Refusing duplicate dispatch: a call for ${maskPhone(phone)} (purpose "${purpose}") is still locked` +
          `${heldBy} (dispatched at ${when}). It has not been released because no confirmed terminal status has ` +
          "been recorded for it yet -- call releaseLock() once get_call_run returns one, or ask the user to " +
          "explicitly confirm an override before retrying.",
      );
    }

    const record = {
      planId,
      maskedPhone: maskPhone(phone),
      purpose,
      dispatchedAt: new Date().toISOString(),
      ...meta,
    };
    fs.writeFileSync(lockPath, JSON.stringify(record, null, 2));
    appendHistory(phone, purpose, { event: "dispatched", planId, at: record.dispatchedAt, ...meta });
    return record;
  });
}

/**
 * Releases the dispatch lock. Compare-and-delete: only releases if `planId`
 * matches the lock's current owner, and requires a confirmed terminal status
 * from get_call_run. Records the outcome in the durable history journal (the
 * journal entry is never removed, even though the lock file is). Runs inside
 * the same per-(phone,purpose) mutex as acquireLock, so a release can't race
 * a concurrent acquire/override for the same key either.
 */
function releaseLock({ phone, purpose, planId, terminalStatus }) {
  requireFields({ phone, purpose, planId });
  const status = String(terminalStatus || "").toUpperCase();
  if (!TERMINAL_STATUSES.has(status)) {
    throw new Error(
      `releaseLock requires a confirmed terminal status (one of: ${[...TERMINAL_STATUSES].join(", ")}); ` +
        `got ${JSON.stringify(terminalStatus)}. Do not release the lock while a call may still be in progress.`,
    );
  }

  return withMutex(phone, purpose, () => {
    const lockPath = lockPathFor(phone, purpose);
    const existing = readLockFile(lockPath);

    if (existing === null) {
      return { released: false, lockPath, reason: "No active lock found for this phone+purpose; nothing to release." };
    }
    if (existing.corrupted) {
      throw new Error(
        "Lock file is corrupted and its owner cannot be verified -- refusing to release without knowing who " +
          "holds it. Clear it manually, or use an explicit override on the next acquireLock.",
      );
    }
    if (existing.planId !== planId) {
      throw new Error(
        `Refusing to release: the current lock for ${maskPhone(phone)} (purpose "${purpose}") is held by ` +
          `plan_id ${JSON.stringify(existing.planId)}, not ${JSON.stringify(planId)}. It has likely been ` +
          "overridden by a different dispatch since this run acquired it -- not releasing a lock this run no " +
          "longer owns.",
      );
    }

    fs.unlinkSync(lockPath);
    appendHistory(phone, purpose, { event: "released", planId, at: new Date().toISOString(), terminalStatus: status });
    return { released: true, lockPath, terminalStatus: status };
  });
}

module.exports = {
  TERMINAL_STATUSES,
  LOCK_DIR,
  HISTORY_DIR,
  lockPathFor,
  historyPathFor,
  mutexPathFor,
  hasBeenDispatched,
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
      "Usage: node call-lock.js --check|--acquire|--release|--history-check --phone <E.164> --purpose <string> " +
        "[--plan-id <id>] [--override] [--run-id <id>] [--terminal-status <STATUS>]",
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
    if (args["history-check"]) {
      const dispatched = hasBeenDispatched({ phone: args.phone, purpose: args.purpose, planId: args["plan-id"] });
      console.log(JSON.stringify({ alreadyDispatched: dispatched }, null, 2));
      if (dispatched) process.exitCode = 1;
      return;
    }
    if (args.acquire) {
      const record = acquireLock({
        phone: args.phone,
        purpose: args.purpose,
        planId: args["plan-id"],
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
        planId: args["plan-id"],
        terminalStatus: args["terminal-status"],
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.error("Specify --check, --acquire, --release, or --history-check.");
    process.exitCode = 1;
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

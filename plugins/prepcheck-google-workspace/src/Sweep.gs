/**
 * PrepCheck — the sweep.
 *
 * Apps Script cannot hold a process open for 48 hours, so there are no waits.
 * Every pending action is a next_call_at timestamp in the Sheet, and an hourly
 * trigger picks up whatever has fallen due.
 */

/** Run once from the editor to install the hourly trigger. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sweep') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sweep').timeBased().everyHours(1).create();
  Logger.log('Hourly sweep installed.');
}

/**
 * Main loop. Selects due rows and places one call each.
 * Guarded by a lock so overlapping executions cannot double-dial.
 */
function sweep() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Sweep already running; skipping.');
    return;
  }
  try {
    const now = new Date();
    const due = readPatients_().filter(r => isDue_(r, now));
    Logger.log('Due rows: ' + due.length);
    due.forEach(r => {
      try {
        placeCheckpointCall_(r);
      } catch (err) {
        const safe = maskFreeText_(String(err), 200);
        logEvent_(r.row_id, '', r.checkpoint, 'SWEEP_ERROR', safe);
        // A dispatch that failed must not be retried on the next sweep until
        // a person has looked at why.
        hold_(r, 'Call could not be placed: ' + safe);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * A row is due when it is waiting on a call and its timestamp has passed.
 * STAFF_REVIEW, IN_CALL, CONFIRMED and NOT_PREPARED are not callable states,
 * which is what makes hold_() a genuine stop rather than a label.
 */
function isDue_(r, now) {
  const callable = [STATE.PENDING, STATE.PARTIAL, STATE.NO_ANSWER];
  if (callable.indexOf(r.state) < 0) return false;
  if (!r.next_call_at) return false;
  if (!r.checkpoint || r.checkpoint === 'DONE') return false;
  if (!isE164_(r.phone_e164)) return false;
  const due = new Date(r.next_call_at);
  if (isNaN(due.getTime())) return false;
  return due <= now;
}

/** Places the call for this row's current checkpoint. */
function placeCheckpointCall_(r) {
  // Second validation point. createCall_ checks too, but refusing here keeps
  // a malformed row out of the IN_CALL state entirely.
  if (!isE164_(r.phone_e164)) {
    return hold_(r, 'Phone number is not valid E.164, so no call was placed. ' +
      'Correct the number and reset the patient.');
  }
  if (!r.procedure_at || isNaN(new Date(r.procedure_at).getTime())) {
    return hold_(r, 'Procedure date is missing or unreadable, so no call was ' +
      'placed.');
  }

  const items = prepItemsFor_(r.procedure, r.checkpoint);
  if (!items.length) {
    // Nothing to verify at this checkpoint — advance rather than call.
    advanceCheckpoint_(r, STATE.PREPARED);
    return;
  }

  const attemptTag = r.checkpoint + 'c' + r.partial_cycles + 'n' + r.no_answer_attempts;
  const { call_id } = createCall_(r, r.checkpoint, items, attemptTag);

  updateRow_(r._row, {
    state: STATE.IN_CALL,
    call_id: call_id,
    next_call_at: ''
  });
}

/**
 * Computes when a checkpoint call should fire, from the procedure time.
 * Used when scheduling a fresh patient or moving to the next checkpoint.
 */
function checkpointDueAt_(procedureAt, checkpoint) {
  const offset = CHECKPOINT_OFFSET_HOURS[checkpoint];
  return new Date(new Date(procedureAt).getTime() - offset * 3600 * 1000);
}

/**
 * Schedules any row that has no next_call_at yet — i.e. newly added
 * patients typed in by clinic staff. Safe to run repeatedly.
 */
function scheduleNewRows() {
  readPatients_().forEach(r => {
    if (r.state !== STATE.PENDING || r.next_call_at || !r.procedure_at) return;
    const cp = r.checkpoint || CHECKPOINTS[0];
    updateRow_(r._row, {
      checkpoint: cp,
      next_call_at: checkpointDueAt_(r.procedure_at, cp).toISOString()
    });
  });
}

/** Manual trigger for the demo: force one row to call now. */
function callRowNow(rowId) {
  const r = findByRowId_(rowId);
  if (!r) throw new Error('No such row_id: ' + rowId);
  if (r.state === STATE.IN_CALL) {
    throw new Error('A call is already in flight for ' + rowId + '.');
  }
  placeCheckpointCall_(r);
}

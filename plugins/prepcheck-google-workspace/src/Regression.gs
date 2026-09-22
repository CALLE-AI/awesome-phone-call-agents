/**
 * PrepCheck — readiness trajectory and regression detection.
 *
 * A prep checklist is not a single yes/no. Across multiple calls, individual
 * items move independently: a patient can collect the kit and, in the same
 * conversation, reveal that the blood test they had done was never actually
 * completed. Overall status stays PARTIAL both times, so a state machine that
 * only tracks overall status sees no change at all.
 *
 * This module compares each call's per-item result against the previous
 * call's, and records what moved:
 *
 *   resolved  — was outstanding, now done
 *   regressed — was done, now outstanding
 *   net       — did overall readiness actually improve?
 *
 * A regression is the signal worth acting on. It means the clinic's picture of
 * this patient was wrong, not merely incomplete.
 */

/**
 * Run once to add the two trajectory columns to an existing sheet.
 * Safe to run repeatedly.
 */
function addRegressionColumns() {
  const p = sheet_(SHEET_PATIENTS);
  const headers = p.getRange(1, 1, 1, p.getLastColumn()).getValues()[0];

  ['prep_snapshot', 'readiness_delta'].forEach(name => {
    if (headers.indexOf(name) >= 0) return;
    const col = p.getLastColumn() + 1;
    p.getRange(1, col).setValue(name).setFontWeight('bold');
  });

  Logger.log('Columns present: ' +
    p.getRange(1, 1, 1, p.getLastColumn()).getValues()[0].join(', '));
}

/**
 * Compares this call's items against the stored snapshot from the last call.
 * Returns { resolved, regressed, stillOutstanding, net, summary }.
 */
function diffReadiness_(previousSnapshot, completedNow, outstandingNow) {
  const prev = previousSnapshot || { completed: [], outstanding: [] };
  const norm = s => String(s || '').trim().toLowerCase();

  const prevCompleted = (prev.completed || []).map(norm);
  const prevOutstanding = (prev.outstanding || []).map(norm);
  const nowCompleted = (completedNow || []).map(norm);
  const nowOutstanding = (outstandingNow || []).map(norm);

  // Was outstanding last time, done now.
  const resolved = (outstandingNow === null ? [] : prevOutstanding)
    .filter(i => nowCompleted.indexOf(i) >= 0);

  // Was done last time, outstanding now. This is the interesting case.
  const regressed = prevCompleted.filter(i => nowOutstanding.indexOf(i) >= 0);

  const stillOutstanding = nowOutstanding
    .filter(i => prevOutstanding.indexOf(i) >= 0);

  let net;
  if (!prev.completed.length && !prev.outstanding.length) {
    net = 'baseline';
  } else if (regressed.length && resolved.length) {
    net = resolved.length > regressed.length ? 'mixed_improved' : 'no_improvement';
  } else if (regressed.length) {
    net = 'declined';
  } else if (resolved.length) {
    net = 'improved';
  } else {
    net = 'unchanged';
  }

  // Item labels come from the clinic's own PrepSteps sheet, but the arrays
  // arrive from the provider, so treat them as free text on the way out.
  const parts = [];
  if (resolved.length) parts.push('resolved: ' + maskFreeText_(resolved.join(', '), 120));
  if (regressed.length) parts.push('REGRESSED: ' + maskFreeText_(regressed.join(', '), 120));
  if (stillOutstanding.length) {
    parts.push('still outstanding: ' + maskFreeText_(stillOutstanding.join(', '), 120));
  }
  parts.push('net: ' + net);

  return {
    resolved: resolved,
    regressed: regressed,
    stillOutstanding: stillOutstanding,
    net: net,
    summary: parts.join(' | ')
  };
}

/** Masks each item and drops anything that is not a non-empty string. */
function sanitiseItems_(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => typeof i === 'string')
    .map(i => maskFreeText_(i, 120))
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Called from the webhook handler on every completed call, before the state
 * transition. Writes the trajectory columns and returns the diff so the
 * transition can act on it.
 */
function recordReadiness_(r, result) {
  let previous = null;
  try {
    previous = r.prep_snapshot ? JSON.parse(r.prep_snapshot) : null;
  } catch (e) {
    previous = null;
  }

  // The item arrays come back from the provider, so they are free text. They
  // are sanitised once, here, and that sanitised form is what gets both
  // compared and stored — comparing raw against masked would register a
  // change that never happened.
  const completed = sanitiseItems_(result.items_completed);
  const outstanding = sanitiseItems_(result.items_outstanding);

  const diff = diffReadiness_(previous, completed, outstanding);

  const snapshot = {
    completed: completed,
    outstanding: outstanding,
    checkpoint: r.checkpoint,
    at: new Date().toISOString()
  };

  updateRow_(r._row, {
    prep_snapshot: JSON.stringify(snapshot),
    readiness_delta: diff.summary
  });

  logEvent_(r.row_id, r.call_id, r.checkpoint, 'READINESS', diff.summary);

  return diff;
}

/**
 * A regression means something the clinic recorded as done is not done.
 * That is a data-integrity problem, not just an incomplete checklist, so it
 * always reaches a human — regardless of what the overall prep_status said.
 */
function notifyRegression_(r, diff) {
  notifyStaff_(r,
    'For review — a previously confirmed step is reported as not complete',
    [
      'On an earlier call this step was recorded as done. On the latest call ' +
      'the patient reported it as not done.',
      '',
      'Reported as not done: ' + maskFreeText_(diff.regressed.join(', '), 160),
      diff.resolved.length
        ? 'Reported as done since the last call: ' +
          maskFreeText_(diff.resolved.join(', '), 160)
        : '',
      'Net change: ' + diff.net,
      '',
      'Which of the two reports is correct is not something this system can ' +
      'establish. No further calls will be placed for this patient until ' +
      'someone has checked the record.'
    ].filter(Boolean).join('\n'));
}

/**
 * Returns one patient to a clean first-call state. Used by the panel's
 * "Start this patient over" action, and for re-running the examples in
 * examples/ without editing cells by hand.
 */
function resetRow(rowId) {
  const r = findByRowId_(rowId);
  if (!r) throw new Error('No such row_id: ' + rowId);
  updateRow_(r._row, {
    checkpoint: CHECKPOINTS[0],
    state: STATE.PENDING,
    next_call_at: '',
    partial_cycles: 0,
    no_answer_attempts: 0,
    call_id: '',
    last_outcome: '',
    items_outstanding: '',
    staff_note: '',
    prep_snapshot: '',
    readiness_delta: ''
  });
  logEvent_(rowId, '', CHECKPOINTS[0], 'RESET', 'Returned to first checkpoint.');
}

/**
 * Rotates the webhook shared secret without changing the deployment URL.
 * The new value is not logged — read it from Project Settings > Script
 * Properties. Execution logs outlive the session and are visible to every
 * editor of the project.
 */
function rotateWebhookSecret() {
  props_().setProperty('WEBHOOK_SECRET', Utilities.getUuid());
  Logger.log('Webhook secret rotated. Read the new value from ' +
    'Project Settings > Script Properties.');
}

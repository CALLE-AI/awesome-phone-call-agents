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

  const parts = [];
  if (resolved.length) parts.push('resolved: ' + resolved.join(', '));
  if (regressed.length) parts.push('REGRESSED: ' + regressed.join(', '));
  if (stillOutstanding.length) parts.push('still outstanding: ' + stillOutstanding.join(', '));
  parts.push('net: ' + net);

  return {
    resolved: resolved,
    regressed: regressed,
    stillOutstanding: stillOutstanding,
    net: net,
    summary: parts.join(' | ')
  };
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

  const diff = diffReadiness_(
    previous,
    result.items_completed || [],
    result.items_outstanding || []
  );

  const snapshot = {
    completed: result.items_completed || [],
    outstanding: result.items_outstanding || [],
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
    'Preparation regressed — previously confirmed step is not complete',
    [
      'A step recorded as complete on an earlier call is now reported as not done.',
      '',
      'Regressed: ' + diff.regressed.join(', '),
      diff.resolved.length ? 'Resolved since last call: ' + diff.resolved.join(', ') : '',
      'Net readiness: ' + diff.net,
      '',
      'Verify the record before the procedure goes ahead.'
    ].filter(Boolean).join('\n'));
}

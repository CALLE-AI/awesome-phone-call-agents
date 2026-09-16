/**
 * PrepCheck — webhook receiver and state transitions.
 *
 * Deploy this project as a web app (Deploy > New deployment > Web app,
 * execute as yourself, access "Anyone"), then store the /exec URL in the
 * WEBHOOK_URL script property. CALL-E posts terminal call results here.
 */

function doPost(e) {
  try {
    // Fail closed. An unconfigured secret is not "no authentication
    // required" — it is an install that is not ready to receive anything.
    const expected = getWebhookSecret_();
    if (!expected) {
      logEvent_('', '', '', 'WEBHOOK_REJECTED', 'No WEBHOOK_SECRET configured.');
      return reply_(503, { ok: false, error: 'not_configured' });
    }

    const token = e && e.parameter ? e.parameter.token : '';
    if (token !== expected) {
      logEvent_('', '', '', 'WEBHOOK_REJECTED', 'Bad or missing token.');
      return reply_(401, { ok: false, error: 'unauthorized' });
    }

    if (!e || !e.postData || !e.postData.contents) {
      return reply_(400, { ok: false, error: 'empty_body' });
    }

    const body = JSON.parse(e.postData.contents);
    const outcome = handleCallResult_(body);
    return reply_(200, { ok: true, outcome: outcome });

  } catch (err) {
    logEvent_('', '', '', 'WEBHOOK_ERROR', maskFreeText_(String(err), 200));
    // Deliberately terse: the caller is unauthenticated until proven
    // otherwise and does not need our internals.
    return reply_(400, { ok: false, error: 'rejected' });
  }
}

function reply_(code, obj) {
  // Apps Script web apps always answer 200; the status travels in the body
  // so a caller can distinguish rejected from accepted.
  return ContentService.createTextOutput(
    JSON.stringify(Object.assign({ status: code }, obj)))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Health check so you can confirm the deployment is live from a browser. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: 'prepcheck' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Maps a terminal CALL-E result onto a state transition.
 */
function handleCallResult_(body) {
  const meta = body.metadata || (body.data && body.data.metadata) || {};
  const rowId = meta.row_id;
  if (!rowId) throw new Error('Webhook missing metadata.row_id');

  const r = findByRowId_(rowId);
  if (!r) throw new Error('Unknown row_id in webhook: ' + rowId);

  const recipient = (body.recipients && body.recipients[0]) || {};
  const result = recipient.structured_result || body.structured_result || {};
  const status = body.status || '';
  const confidence = (body.completion_confidence || {}).label || '';

  logEvent_(rowId, body.call_id || r.call_id, r.checkpoint, 'RESULT',
    { status: maskFreeText_(status, 40),
      prep_status: maskFreeText_(result.prep_status, 40),
      confidence: maskFreeText_(confidence, 20) });

  // ---- accept a terminal result once, for the call we are actually waiting
  // on. Anything else is stale, duplicated, or out of order, and a workflow
  // that can dial people must not act on it twice. ----

  if (r.state !== STATE.IN_CALL) {
    return hold_(r, 'Terminal result arrived for a patient who is not ' +
      'awaiting one (state: ' + r.state + '). Not applied.');
  }

  if (meta.checkpoint && meta.checkpoint !== r.checkpoint) {
    return hold_(r, 'Terminal result is for checkpoint ' +
      maskFreeText_(meta.checkpoint, 12) + ' but this patient is at ' +
      r.checkpoint + '. Not applied.');
  }

  if (body.call_id && r.call_id && String(body.call_id) !== String(r.call_id)) {
    return hold_(r, 'Terminal result is for a different call than the one ' +
      'in flight. Not applied.');
  }

  // ---- outcomes that stop the workflow rather than schedule another call ----

  if (result.asked_to_stop === true) {
    return hold_(r, 'Patient asked not to be called again. No further calls ' +
      'will be placed. Staff to contact by another channel if needed.');
  }

  if (result.flag_for_staff) {
    return hold_(r, 'Patient raised a clinical or unclear point on the call. ' +
      'A clinician should follow up.');
  }

  // Did not reach the patient at all. Retrying an unanswered call is the one
  // case where dialling again is appropriate.
  if (status !== 'completed' || !body.task_completed || !result.prep_status) {
    return onNoAnswer_(r, status);
  }

  // Reached someone, but never confirmed it was the patient.
  if (result.identity_verified === false) {
    return onNoAnswer_(r, 'identity_unverified');
  }

  // Compare this call's per-item results against the previous call's.
  // Overall status can stay identical while individual items move.
  const diff = recordReadiness_(r, result);

  if (diff.regressed.length) {
    // A step the clinic recorded as done is not done. The record is wrong,
    // so the next action is a person checking it — not another call built on
    // the same bad record.
    notifyRegression_(r, diff);
    return hold_(r, 'A previously confirmed step is reported as not ' +
      'complete: ' + maskFreeText_(diff.regressed.join(', '), 120) +
      '. Verify the record before the procedure goes ahead.');
  }

  switch (result.prep_status) {
    case 'prepared':
      return onPrepared_(r, result);
    case 'partial':
      return onPartial_(r, result);
    case 'not_prepared':
      return onNotPrepared_(r, result);
    default:
      return hold_(r, 'Preparation status could not be established on the call.');
  }
}

/* ---------- transitions ---------- */

function onPrepared_(r, result) {
  updateRow_(r._row, {
    last_outcome: 'prepared',
    items_outstanding: '',
    no_answer_attempts: 0,
    partial_cycles: 0
  });
  advanceCheckpoint_(r, STATE.PREPARED);
  return 'prepared';
}

function onPartial_(r, result) {
  const cycles = Number(r.partial_cycles || 0) + 1;
  const outstanding = (result.items_outstanding || []).join('; ');

  if (cycles > MAX_PARTIAL_CYCLES) {
    return hold_(r,
      'Patient has said twice they would complete preparation and has not. ' +
      'Outstanding: ' + maskFreeText_(outstanding, 120));
  }

  // Never schedule a callback past the procedure itself.
  const callback = new Date(Date.now() + PARTIAL_CALLBACK_HOURS * 3600 * 1000);
  const procedure = new Date(r.procedure_at);
  const when = callback >= procedure
    ? new Date(procedure.getTime() - 12 * 3600 * 1000)
    : callback;

  updateRow_(r._row, {
    state: STATE.PARTIAL,
    partial_cycles: cycles,
    items_outstanding: maskFreeText_(outstanding, 200),
    last_outcome: 'partial',
    next_call_at: when.toISOString(),
    call_id: ''
  });
  return 'partial';
}

/**
 * The patient said they cannot be ready. PrepCheck records that and asks a
 * person to decide. It does not release the slot itself: what a patient says
 * on a call is a report, not a clinical or scheduling decision, and this
 * system has no way to verify it.
 */
function onNotPrepared_(r, result) {
  const outstanding = maskFreeText_((result.items_outstanding || []).join('; '), 200);
  updateRow_(r._row, {
    state: STATE.NOT_PREPARED,
    checkpoint: 'DONE',
    last_outcome: 'not_prepared',
    items_outstanding: outstanding,
    staff_note: 'Patient reports they cannot complete preparation in time. ' +
      'Recommend reviewing the slot.',
    next_call_at: '',
    call_id: ''
  });
  notifyStaff_(r,
    'For review — patient reports they cannot complete preparation',
    'This is what the patient said on the call, not a decision. A member of ' +
    'staff should confirm it and decide whether to release the slot.\n\n' +
    'Reported outstanding: ' + outstanding + '\n' +
    'Reschedule requested: ' + maskFreeText_(result.wants_reschedule || 'unknown', 20));
  return 'not_prepared';
}

function onNoAnswer_(r, status) {
  const attempts = Number(r.no_answer_attempts || 0) + 1;

  if (attempts > MAX_NO_ANSWER_ATTEMPTS) {
    return hold_(r, 'No contact after ' + MAX_NO_ANSWER_ATTEMPTS +
      ' attempts (last status: ' + maskFreeText_(status, 40) + ').');
  }

  // Retry at a different time of day, and never past the procedure.
  const retry = new Date(Date.now() + NO_ANSWER_RETRY_HOURS * 3600 * 1000);
  const procedure = new Date(r.procedure_at);
  if (retry >= procedure) {
    return hold_(r, 'No contact before the procedure time.');
  }

  updateRow_(r._row, {
    state: STATE.NO_ANSWER,
    no_answer_attempts: attempts,
    last_outcome: 'no_answer:' + maskFreeText_(status, 30),
    next_call_at: retry.toISOString(),
    call_id: ''
  });
  return 'no_answer';
}

/**
 * PREPARED at a non-final checkpoint moves to the next one rather than
 * terminating. This is what makes the Sheet show a multi-day journey.
 */
function advanceCheckpoint_(r, reachedState) {
  const idx = CHECKPOINTS.indexOf(r.checkpoint);
  const next = CHECKPOINTS[idx + 1];

  if (!next) {
    updateRow_(r._row, {
      state: STATE.CONFIRMED,
      checkpoint: 'DONE',
      next_call_at: '',
      call_id: ''
    });
    notifyPatientConfirmed_(r);
    return;
  }

  updateRow_(r._row, {
    state: STATE.PENDING,
    checkpoint: next,
    next_call_at: checkpointDueAt_(r.procedure_at, next).toISOString(),
    call_id: ''
  });
}

/**
 * Stops the workflow for this patient and hands it to a person.
 *
 * Every path that is not "keep going safely" ends here: an unknown outcome, a
 * stale or duplicated result, a regression, an opt-out, a clinical remark, or
 * a patient who has stopped making progress. Clearing next_call_at and moving
 * out of the callable states is what guarantees no further call is placed —
 * the sweep only ever selects PENDING, PARTIAL and NO_ANSWER rows.
 *
 * Nothing written here is a decision. It is a note asking someone to make one.
 */
function hold_(r, note) {
  const safe = maskFreeText_(note, 300);
  updateRow_(r._row, {
    state: STATE.STAFF_REVIEW,
    checkpoint: 'DONE',
    staff_note: safe,
    next_call_at: '',
    call_id: ''
  });
  notifyStaff_(r, 'For review', safe);
  return 'staff_review';
}

/* ---------- notifications ---------- */

function notifyStaff_(r, subject, detail) {
  // No-call mode means no side effects at all, email included. A reviewer
  // trying the plugin out should not send mail to anyone.
  if (!LIVE_CALLS_ENABLED) {
    logEvent_(r.row_id, r.call_id, r.checkpoint, 'NOTIFY_SUPPRESSED',
      subject + ' — ' + maskFreeText_(detail, 200));
    return;
  }

  // No configured address means no mail. There is deliberately no fallback
  // to whoever happens to own the script.
  const to = getStaffEmail_();
  if (!to) {
    logEvent_(r.row_id, r.call_id, r.checkpoint, 'NOTIFY_SKIPPED',
      'STAFF_EMAIL not set. ' + subject);
    return;
  }

  // A notification failure must never block a state transition. If the mail
  // quota is exhausted or a scope is missing, the patient's state still has
  // to move — the Sheet is the record of truth, email is a courtesy.
  try {
    MailApp.sendEmail({
      to: to,
      subject: '[PrepCheck] ' + subject + ' — ' + r.patient_name,
      body: [
        'Patient: ' + r.patient_name + ' (' + r.row_id + ')',
        'Procedure: ' + maskFreeText_(r.procedure, 60) + ' at ' + r.procedure_at,
        'Checkpoint: ' + r.checkpoint,
        '',
        detail
      ].join('\n')
    });
  } catch (err) {
    logEvent_(r.row_id, r.call_id, r.checkpoint, 'NOTIFY_FAILED', String(err));
  }
}

function notifyPatientConfirmed_(r) {
  // Placeholder: the demo confirms to staff, not to a synthetic patient.
  logEvent_(r.row_id, '', 'DONE', 'CONFIRMED', 'All checkpoints passed.');
}

/**
 * Safety net. If a webhook is ever missed, rows stuck IN_CALL are reconciled
 * by polling. Install on a 6-hourly trigger if you want it.
 */
function reconcileStuckCalls() {
  readPatients_().filter(r => r.state === STATE.IN_CALL && r.call_id &&
      r.call_id.indexOf('dry_') !== 0)
    .forEach(r => {
      const body = fetchCall_(r.call_id);
      if (body && body.status && body.status !== 'in_progress') {
        body.metadata = body.metadata || { row_id: r.row_id };
        handleCallResult_(body);
      }
    });
}

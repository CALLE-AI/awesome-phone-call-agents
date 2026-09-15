/**
 * PrepCheck — webhook receiver and state transitions.
 *
 * Deploy this project as a web app (Deploy > New deployment > Web app,
 * execute as yourself, access "Anyone"), then store the /exec URL in the
 * WEBHOOK_URL script property. CALL-E posts terminal call results here.
 */

function doPost(e) {
  try {
    const token = e && e.parameter ? e.parameter.token : '';
    if (getWebhookSecret_() && token !== getWebhookSecret_()) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const body = JSON.parse(e.postData.contents);
    handleCallResult_(body);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logEvent_('', '', '', 'WEBHOOK_ERROR', String(err));
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
    { status: status, prep_status: result.prep_status, confidence: confidence });

  // Did not reach the patient at all.
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
    notifyRegression_(r, diff);
  }

  if (result.flag_for_staff) {
    return escalate_(r, 'Patient raised a clinical or unclear point on the call.');
  }

  switch (result.prep_status) {
    case 'prepared':
      return onPrepared_(r, result);
    case 'partial':
      return onPartial_(r, result);
    case 'not_prepared':
      return onNotPrepared_(r, result);
    default:
      return escalate_(r, 'Prep status could not be established on the call.');
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
}

function onPartial_(r, result) {
  const cycles = Number(r.partial_cycles || 0) + 1;
  const outstanding = (result.items_outstanding || []).join('; ');

  if (cycles > MAX_PARTIAL_CYCLES) {
    return escalate_(r,
      'Patient has said twice they would complete prep and has not. ' +
      'Outstanding: ' + outstanding);
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
    items_outstanding: outstanding,
    last_outcome: 'partial',
    next_call_at: when.toISOString(),
    call_id: ''
  });
}

function onNotPrepared_(r, result) {
  updateRow_(r._row, {
    state: STATE.NOT_PREPARED,
    checkpoint: 'DONE',
    last_outcome: 'not_prepared',
    items_outstanding: (result.items_outstanding || []).join('; '),
    next_call_at: '',
    call_id: ''
  });
  notifyStaff_(r,
    'Slot should be released — patient cannot complete prep',
    'Outstanding: ' + (result.items_outstanding || []).join('; ') +
    '\nReschedule requested: ' + (result.wants_reschedule || 'unknown'));
}

function onNoAnswer_(r, status) {
  const attempts = Number(r.no_answer_attempts || 0) + 1;

  if (attempts > MAX_NO_ANSWER_ATTEMPTS) {
    return escalate_(r, 'No contact after ' + MAX_NO_ANSWER_ATTEMPTS +
      ' attempts (last status: ' + status + ').');
  }

  // Retry at a different time of day, and never past the procedure.
  const retry = new Date(Date.now() + NO_ANSWER_RETRY_HOURS * 3600 * 1000);
  const procedure = new Date(r.procedure_at);
  if (retry >= procedure) {
    return escalate_(r, 'No contact before the procedure time.');
  }

  updateRow_(r._row, {
    state: STATE.NO_ANSWER,
    no_answer_attempts: attempts,
    last_outcome: 'no_answer:' + status,
    next_call_at: retry.toISOString(),
    call_id: ''
  });
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

function escalate_(r, note) {
  updateRow_(r._row, {
    state: STATE.STAFF_REVIEW,
    checkpoint: 'DONE',
    staff_note: note,
    next_call_at: '',
    call_id: ''
  });
  notifyStaff_(r, 'Needs a human', note);
}

/* ---------- notifications ---------- */

function notifyStaff_(r, subject, detail) {
  // A notification failure must never block a state transition. If the mail
  // quota is exhausted or a scope is missing, the patient's state still has
  // to move — the Sheet is the record of truth, email is a courtesy.
  try {
    MailApp.sendEmail({
      to: getStaffEmail_(),
      subject: '[PrepCheck] ' + subject + ' — ' + r.patient_name,
      body: [
        'Patient: ' + r.patient_name + ' (' + r.row_id + ')',
        'Procedure: ' + r.procedure + ' at ' + r.procedure_at,
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

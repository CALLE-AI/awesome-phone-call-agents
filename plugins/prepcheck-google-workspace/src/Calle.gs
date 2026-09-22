/**
 * PrepCheck — CALL-E Developer API client.
 *
 * Uses the REST API rather than MCP because MCP's run_call does not accept a
 * webhook_url, and Apps Script executions cannot poll for the life of a call.
 */

/**
 * The structured result PrepCheck asks CALL-E to return for each patient.
 * Deliberately narrow: completion status only, no clinical content.
 */
function prepResultSchema_() {
  return {
    type: 'object',
    required: ['prep_status'],
    properties: {
      prep_status: {
        type: 'string',
        enum: ['prepared', 'partial', 'not_prepared', 'unclear'],
        description: 'prepared = every prep step done. partial = patient ' +
          'states they will complete outstanding steps before the procedure. ' +
          'not_prepared = cannot be ready in time. unclear = could not establish.'
      },
      items_completed: { type: 'array', items: { type: 'string' } },
      items_outstanding: { type: 'array', items: { type: 'string' } },
      wants_reschedule: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      outstanding_plan: {
        type: 'string',
        description: 'For any step not yet done: what the patient says they ' +
          'have actually arranged to complete it — a booked appointment, a ' +
          'specific day, or nothing concrete. Logistics only; do not record ' +
          'anything the patient said about their health, symptoms or ' +
          'medication. Empty if all steps are done.'
      },
      asked_to_stop: {
        type: 'boolean',
        description: 'True if the patient asked not to be called again, ' +
          'by any wording. Once true, no further call is placed.'
      },
      flag_for_staff: {
        type: 'boolean',
        description: 'True if the patient raised anything clinical, was ' +
          'confused about instructions, or asked a question the agent ' +
          'declined to answer.'
      },
      identity_verified: { type: 'boolean' }
    }
  };
}

/**
 * A copy of the outbound payload that is safe to write to a sheet a clinic
 * will share, screenshot, or paste into a support ticket. The webhook secret
 * and the patient's full number never appear in the log.
 */
function redactPayload_(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  if (copy.webhook_url) {
    copy.webhook_url = String(copy.webhook_url).split('?')[0] + '?token=[redacted]';
  }
  (copy.recipients || []).forEach(r => {
    r.phones = (r.phones || []).map(maskPhone_);
  });
  return copy;
}

/**
 * Places one outbound call. Returns { call_id }.
 */
function createCall_(patient, checkpoint, prepItems, attemptTag) {
  // Dispatch entry point. Nothing unvalidated gets past here, in either mode
  // — a dry run that would have dialled a malformed number is still a bug.
  if (!isE164_(patient.phone_e164)) {
    throw new Error('Refusing to dispatch: phone number is not ASCII E.164 ' +
      '(expected +<country><number>, got "' + maskFreeText_(patient.phone_e164, 24) + '").');
  }
  if (!prepItems || !prepItems.length) {
    throw new Error('Refusing to dispatch: no preparation steps for ' +
      maskFreeText_(patient.procedure, 40) + ' at checkpoint ' + checkpoint + '.');
  }

  const payload = {
    task: buildTask_(patient, checkpoint, prepItems),
    recipients: [{
      phones: [patient.phone_e164],
      region: patient.region || 'US',
      locale: patient.locale || 'en-US'
    }],
    recipient_result_schema: prepResultSchema_(),
    metadata: {
      row_id: String(patient.row_id),
      checkpoint: checkpoint,
      source: 'prepcheck'
    },
    webhook_url: getWebhookUrl_() + '?token=' +
      encodeURIComponent(getWebhookSecret_())
  };

  if (!LIVE_CALLS_ENABLED) {
    logEvent_(patient.row_id, '', checkpoint, 'DRY_RUN', redactPayload_(payload));
    return { call_id: 'dry_' + Utilities.getUuid().slice(0, 8), dryRun: true };
  }

  const res = UrlFetchApp.fetch(CALLE_BASE_URL + '/v1/calls', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + getApiKey_(),
      // Same row + checkpoint + attempt must never double-dial.
      'Idempotency-Key': 'prepcheck_' + patient.row_id + '_' + checkpoint +
                         '_' + attemptTag
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    const safe = maskFreeText_(body, 300);
    logEvent_(patient.row_id, '', checkpoint, 'CREATE_FAILED', code + ' ' + safe);
    throw new Error('CALL-E create failed: ' + code + ' ' + safe);
  }

  const json = JSON.parse(body);
  const callId = json.call_id || json.id || (json.data && json.data.call_id);
  logEvent_(patient.row_id, callId, checkpoint, 'CALL_CREATED', '');
  return { call_id: callId, raw: json };
}

/** Polling fallback if a webhook is ever missed. */
function fetchCall_(callId) {
  const res = UrlFetchApp.fetch(CALLE_BASE_URL + '/v1/calls/' + encodeURIComponent(callId), {
    method: 'get',
    headers: { Authorization: 'Bearer ' + getApiKey_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  return JSON.parse(res.getContentText());
}

/**
 * The call goal. CALL-E plans the conversation from this, so it states the
 * objective and the boundaries rather than scripting every line.
 */
function buildTask_(patient, checkpoint, prepItems) {
  const when = Utilities.formatDate(
    new Date(patient.procedure_at),
    ss_().getSpreadsheetTimeZone(),
    "EEEE d MMMM 'at' h:mm a");

  const checklist = prepItems.map((s, i) => (i + 1) + '. ' + s).join('\n');

  return [
    'You are an automated assistant calling on behalf of ' + CLINIC_NAME + '.',
    '',
    'OPENING (required): State immediately that you are an automated assistant',
    'calling from ' + CLINIC_NAME + '. Then ask to speak to ' + patient.patient_name + '.',
    'Do not disclose any appointment or medical detail until the person has',
    'confirmed they are ' + patient.patient_name + '. If you reach someone else or',
    'voicemail, leave only the clinic name and this callback number: ' +
      CLINIC_CALLBACK + '. Do not state the procedure, the date, or any prep',
    'instruction in a voicemail or to a third party.',
    '',
    'GOAL: Confirm whether the patient has completed each preparation step',
    'required before their procedure. Their ' + patient.procedure + ' is booked',
    'for ' + when + '.',
    '',
    'Ask about each item one at a time, and record the answer for each.',
    'A step counts as done only if the patient has completed it themselves —',
    'obtaining something is not the same as having done it. If an answer is',
    'ambiguous, ask once to clarify before recording it.',
    'For any step not yet done, ask what they have arranged to complete it:',
    'a booked appointment, a specific day, or nothing yet. Record that as',
    'logistics only — never record what they say about their health.',
    '',
    checklist,
    '',
    'BRANCHES:',
    '- All items done: thank them, say the clinic has their update, and end',
    '  warmly. Do not tell them the appointment is confirmed — there may be',
    '  further preparation to check, and confirming is not your decision.',
    '- Some items outstanding but the patient says they will complete them in',
    '  time: acknowledge, say the clinic may be in touch to check, and end. Do',
    '  not promise a callback or a time for one.',
    '- Patient cannot complete the prep before the procedure: acknowledge it,',
    '  tell them a member of clinic staff will review their appointment and be',
    '  in touch, and end. Do NOT tell them the procedure cannot go ahead, that',
    '  it will be cancelled, or that their slot will be released. You are not',
    '  deciding any of that — a person at the clinic is. Do not offer a new',
    '  date and do not speculate about what the clinic will decide.',
    '- Patient is unsure what the prep involves: do not explain or advise.',
    '  Say a member of clinic staff will call them back, and end.',
    '',
    'HARD LIMITS — these override everything above:',
    '- You verify WHETHER a step was done. Nothing else. You report; the',
    '  clinic decides. Never state or imply an outcome for the appointment.',
    '- Never give medical advice, never interpret symptoms or test results,',
    '  never discuss medication doses, never answer clinical questions.',
    '- If the patient describes symptoms or raises a clinical concern:',
    '  acknowledge briefly, say a clinician will call them back, set',
    '  flag_for_staff true, and end the call. Do not ask follow-up questions',
    '  about the symptom.',
    '- If the patient asks to stop being called, in any wording: agree, set',
    '  asked_to_stop true, and end. Do not offer to call back.',
    '- Never claim to be a nurse, doctor, or human.',
    '- Never make a scheduling commitment. You cannot confirm, cancel, move or',
    '  release an appointment, and you cannot promise that anyone will call.',
    '  Everything you record goes to clinic staff, who decide.'
  ].join('\n');
}

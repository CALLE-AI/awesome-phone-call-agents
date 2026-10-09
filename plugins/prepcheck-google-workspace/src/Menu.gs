/**
 * PrepCheck — the clinic-facing surface.
 *
 * Everything a clinic does with PrepCheck happens inside their own
 * spreadsheet: a menu on the menu bar and a panel down the side. Nobody
 * opens the script editor.
 *
 * The panel has two views. It opens on the day's list — every patient with a
 * procedure coming up, the ones needing attention first. Click a patient and
 * you get their preparation in full.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PrepCheck')
    .addItem('Open patient list', 'showSidebar')
    .addSeparator()
    .addItem('Check who is due a call', 'runSweepNow')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('PrepCheck');
  SpreadsheetApp.getUi().showSidebar(html);
}

/* ---------- shared ---------- */

function toast_(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'PrepCheck', 5);
}

function parseSnapshot_(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Pulls the regressed items back out of the readiness_delta text. */
function regressedFrom_(delta) {
  if (!delta) return [];
  const parts = String(delta).split('|');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.toLowerCase().indexOf('regressed:') === 0) {
      return p.slice(p.indexOf(':') + 1).split(',')
        .map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function netFrom_(delta) {
  if (!delta) return '';
  const parts = String(delta).split('|');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.toLowerCase().indexOf('net:') === 0) return p.split(':')[1].trim();
  }
  return '';
}

/**
 * One word for how this patient stands, plus the group it sorts into.
 * Written for someone glancing at a list, not for a state machine.
 */
function standing_(r) {
  const snapshot = parseSnapshot_(r.prep_snapshot);
  const regressed = regressedFrom_(r.readiness_delta);
  const net = netFrom_(r.readiness_delta);
  const cycles = Number(r.partial_cycles || 0);

  if (r.state === STATE.CONFIRMED)    return w_('Ready', 'settled', 'ready');
  if (r.state === STATE.NOT_PREPARED) return w_('Not ready', 'attention', 'alarm');
  if (r.state === STATE.STAFF_REVIEW) return w_('Needs you', 'attention', 'alarm');
  if (regressed.length)               return w_('Slipped back', 'attention', 'alarm');
  if (r.state === STATE.PARTIAL && (cycles >= 2 || net === 'unchanged')) {
    return w_('Stalled', 'attention', 'warn');
  }
  if (r.state === STATE.PARTIAL)      return w_('In progress', 'working', 'ok');
  if (r.state === STATE.IN_CALL)      return w_('On the phone', 'working', 'ok');
  if (r.state === STATE.NO_ANSWER)    return w_('No answer', 'working', 'warn');
  if (r.state === STATE.PENDING && !snapshot) {
    return w_('Not called yet', 'working', 'idle');
  }
  return w_('Waiting', 'working', 'ok');
}

function w_(word, bucket, tone) {
  return { word: word, bucket: bucket, tone: tone };
}

/** A short line saying what is actually holding this patient up. */
function holdup_(r) {
  const outstanding = String(r.items_outstanding || '').trim();
  if (r.state === STATE.CONFIRMED) return 'Everything done';
  if (outstanding) return 'Waiting on ' + outstanding.split(';')[0].trim();
  if (r.state === STATE.PENDING && !r.prep_snapshot) {
    return r.next_call_at ? 'First call scheduled' : 'Not scheduled yet';
  }
  return '';
}

/* ---------- called from the sidebar ---------- */

/** The clinic header and the whole list, in one call. */
function getQueue() {
  const rows = readPatients_();
  const tz = ss_().getSpreadsheetTimeZone();

  const patients = rows.map(r => {
    const s = standing_(r);
    return {
      rowId: r.row_id,
      name: r.patient_name,
      procedure: r.procedure,
      when: r.procedure_at
        ? Utilities.formatDate(new Date(r.procedure_at), tz, 'EEE d MMM')
        : '',
      sortAt: r.procedure_at ? new Date(r.procedure_at).getTime() : 0,
      word: s.word,
      bucket: s.bucket,
      tone: s.tone,
      holdup: holdup_(r)
    };
  });

  const order = { attention: 0, working: 1, settled: 2 };
  patients.sort((a, b) => {
    if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket];
    return a.sortAt - b.sortAt;
  });

  return {
    clinic: CLINIC_NAME,
    patients: patients,
    liveCalls: LIVE_CALLS_ENABLED
  };
}

/** Everything the card view needs for one patient. */
function getPatientCard(rowId) {
  const r = findByRowId_(rowId);
  if (!r) return null;

  const tz = ss_().getSpreadsheetTimeZone();
  const snapshot = parseSnapshot_(r.prep_snapshot);
  const done = ((snapshot && snapshot.completed) || [])
    .map(s => String(s).trim().toLowerCase());
  const open = ((snapshot && snapshot.outstanding) || [])
    .map(s => String(s).trim().toLowerCase());

  const reached = r.checkpoint === 'DONE'
    ? CHECKPOINTS.length
    : Math.max(0, CHECKPOINTS.indexOf(r.checkpoint));

  // One stage per checkpoint, with the steps it covers.
  const stages = CHECKPOINTS.map((cp, i) => {
    const items = prepItemsFor_(r.procedure, cp).map(label => {
      const key = label.trim().toLowerCase();
      let status = 'unknown';
      if (i === reached) {
        if (done.indexOf(key) >= 0) status = 'done';
        else if (open.indexOf(key) >= 0) status = 'outstanding';
      } else if (i < reached) {
        status = 'done';
      }
      return { label: label, status: status };
    });
    return {
      hoursBefore: CHECKPOINT_OFFSET_HOURS[cp],
      position: i < reached ? 'past' : (i === reached ? 'now' : 'ahead'),
      items: items
    };
  });

  const s = standing_(r);

  return {
    clinic: CLINIC_NAME,
    rowId: r.row_id,
    name: r.patient_name,
    procedure: r.procedure,
    procedureAt: r.procedure_at
      ? Utilities.formatDate(new Date(r.procedure_at), tz, "EEEE d MMMM, h:mm a")
      : '',
    word: s.word,
    tone: s.tone,
    stages: stages,
    regressed: regressedFrom_(r.readiness_delta),
    net: netFrom_(r.readiness_delta),
    outstanding: String(r.items_outstanding || '').split(';')
      .map(x => x.trim()).filter(Boolean),
    partialCycles: Number(r.partial_cycles || 0),
    maxPartialCycles: MAX_PARTIAL_CYCLES,
    noAnswerAttempts: Number(r.no_answer_attempts || 0),
    staffNote: r.staff_note || '',
    nextCallAt: r.next_call_at
      ? Utilities.formatDate(new Date(r.next_call_at), tz, "EEE d MMM, h:mm a")
      : '',
    finished: r.checkpoint === 'DONE',
    liveCalls: LIVE_CALLS_ENABLED
  };
}

/** Opening a patient also moves the spreadsheet cursor to their row. */
function focusRow(rowId) {
  const r = findByRowId_(rowId);
  if (!r) return null;
  const sheet = ss_().getSheetByName(SHEET_PATIENTS);
  if (sheet) {
    ss_().setActiveSheet(sheet);
    sheet.setActiveRange(sheet.getRange(r._row, 1, 1, COLS.length));
  }
  return getPatientCard(rowId);
}

function callPatient(rowId) {
  const r = findByRowId_(rowId);
  if (!r) throw new Error('That patient is no longer in the sheet.');
  placeCheckpointCall_(r);
  toast_('Calling ' + r.patient_name + '.');
  return getPatientCard(rowId);
}

function resetPatient(rowId) {
  const r = findByRowId_(rowId);
  if (!r) throw new Error('That patient is no longer in the sheet.');
  resetRow(rowId);
  toast_(r.patient_name + ' reset to the first checkpoint.');
  return getPatientCard(rowId);
}

function runSweepNow() {
  sweep();
  toast_('Checked for patients due a call.');
  return getQueue();
}

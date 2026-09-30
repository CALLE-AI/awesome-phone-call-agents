/**
 * PrepCheck — Sheet schema, setup, and row accessors.
 *
 * The Sheet is the database, the queue, and the audit log.
 */

const COLS = [
  'row_id',
  'patient_name',
  'phone_e164',
  'region',
  'locale',
  'procedure',
  'procedure_at',      // ISO 8601, clinic local time
  'checkpoint',        // T72 | T24 | DONE
  'state',
  'next_call_at',      // ISO 8601 — the queue key
  'partial_cycles',
  'no_answer_attempts',
  'call_id',
  'last_outcome',
  'items_outstanding',
  'staff_note',
  'updated_at',
  'prep_snapshot',
  'readiness_delta'
];

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Missing sheet: ' + name);
  return s;
}

function colIndex_(name) {
  const i = COLS.indexOf(name);
  if (i < 0) throw new Error('Unknown column: ' + name);
  return i + 1;
}

/**
 * One-time setup: creates the three sheets with headers and sample
 * SYNTHETIC rows. No real patient data. Run from the editor.
 */
function setupSheets() {
  const book = ss_();

  let p = book.getSheetByName(SHEET_PATIENTS) || book.insertSheet(SHEET_PATIENTS);
  p.clear();
  p.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  p.setFrozenRows(1);

  let prep = book.getSheetByName(SHEET_PREP) || book.insertSheet(SHEET_PREP);
  prep.clear();
  prep.getRange(1, 1, 1, 3).setValues([['procedure', 'checkpoint', 'prep_item']])
      .setFontWeight('bold');
  prep.setFrozenRows(1);
  prep.getRange(2, 1, 6, 3).setValues([
    ['Colonoscopy', 'T72', 'collected the bowel prep kit from the pharmacy'],
    ['Colonoscopy', 'T72', 'stopped taking iron tablets'],
    ['Colonoscopy', 'T24', 'started the clear liquid diet'],
    ['Colonoscopy', 'T24', 'stopped eating solid food'],
    ['Upper Endoscopy', 'T72', 'completed the pre-procedure blood test'],
    ['Upper Endoscopy', 'T24', 'stopped eating solid food']
  ]);

  let log = book.getSheetByName(SHEET_LOG) || book.insertSheet(SHEET_LOG);
  log.clear();
  log.getRange(1, 1, 1, 6).setValues([[
    'timestamp', 'row_id', 'call_id', 'checkpoint', 'event', 'detail'
  ]]).setFontWeight('bold');
  log.setFrozenRows(1);

  seedSyntheticPatients();
  applyStateFormatting_();
}

/**
 * SYNTHETIC demo data only. Numbers are from the reserved fictional
 * 555-0100..555-0199 block and are not routable. Replace with a line you
 * own before enabling live calls.
 */
function seedSyntheticPatients() {
  const p = sheet_(SHEET_PATIENTS);
  const now = new Date();
  const inHours = h => new Date(now.getTime() + h * 3600 * 1000).toISOString();

  const rows = [
    ['P001', 'Alex Demo', '+12025550143', 'US', 'en-US', 'Colonoscopy',
     inHours(73), 'T72', STATE.PENDING, inHours(0)],
    ['P002', 'Sam Demo', '+12025550147', 'US', 'en-US', 'Upper Endoscopy',
     inHours(74), 'T72', STATE.PENDING, inHours(0)],
    ['P003', 'Maya Demo', '+12025550162', 'US', 'en-US', 'Colonoscopy',
     inHours(77), 'DONE', STATE.CONFIRMED, '']
  ];

  // Pad each row to the full width so adding a column never breaks the seed.
  const padded = rows.map(r => {
    const full = r.slice();
    while (full.length < COLS.length) full.push('');
    full[COLS.indexOf('partial_cycles')] = 0;
    full[COLS.indexOf('no_answer_attempts')] = 0;
    return full;
  });

  p.getRange(p.getLastRow() + 1, 1, padded.length, COLS.length).setValues(padded);
}

/** Colour-codes the state column so transitions are visible on screen. */
function applyStateFormatting_() {
  const p = sheet_(SHEET_PATIENTS);
  const range = p.getRange(2, colIndex_('state'), p.getMaxRows() - 1, 1);
  range.clearFormat();
  const rule = (text, colour) => SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(text).setBackground(colour).setRanges([range]).build();
  p.setConditionalFormatRules([
    rule(STATE.PENDING, '#f1f3f4'),
    rule(STATE.IN_CALL, '#fff3cd'),
    rule(STATE.PARTIAL, '#ffe0b2'),
    rule(STATE.PREPARED, '#d9ead3'),
    rule(STATE.CONFIRMED, '#b7e1cd'),
    rule(STATE.NOT_PREPARED, '#f4c7c3'),
    rule(STATE.NO_ANSWER, '#e8eaed'),
    rule(STATE.STAFF_REVIEW, '#fce8b2')
  ]);
}

/** Reads every patient row into objects, keeping the sheet row number. */
function readPatients_() {
  const p = sheet_(SHEET_PATIENTS);
  const last = p.getLastRow();
  if (last < 2) return [];
  const values = p.getRange(2, 1, last - 1, COLS.length).getValues();
  return values.map((v, i) => {
    const o = { _row: i + 2 };
    COLS.forEach((c, j) => { o[c] = v[j]; });
    return o;
  });
}

function findByRowId_(rowId) {
  return readPatients_().filter(r => String(r.row_id) === String(rowId))[0] || null;
}

/** Writes a partial update back to one row. */
function updateRow_(sheetRow, patch) {
  const p = sheet_(SHEET_PATIENTS);
  patch.updated_at = new Date().toISOString();
  Object.keys(patch).forEach(k => {
    p.getRange(sheetRow, colIndex_(k)).setValue(patch[k]);
  });
}

/** Prep checklist for one procedure at one checkpoint. */
function prepItemsFor_(procedure, checkpoint) {
  const s = sheet_(SHEET_PREP);
  const last = s.getLastRow();
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, 3).getValues()
    .filter(r => r[0] === procedure && r[1] === checkpoint)
    .map(r => r[2]);
}

function logEvent_(rowId, callId, checkpoint, event, detail) {
  sheet_(SHEET_LOG).appendRow([
    new Date().toISOString(), rowId, callId || '', checkpoint || '', event,
    typeof detail === 'string' ? detail : JSON.stringify(detail)
  ]);
}

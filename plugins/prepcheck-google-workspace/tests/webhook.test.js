/**
 * PrepCheck — webhook handler tests.
 *
 * Runs the real Apps Script source under Node with the Google services
 * mocked. No network, no spreadsheet, no calls, no email.
 *
 *   node tests/webhook.test.js
 *
 * The point of these cases is the property the review asked for: only a
 * genuine non-contact schedules another call. Every unknown, incomplete,
 * unmatched or replayed result stops for staff review.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const source = ['Config.gs', 'Regression.gs', 'Webhook.gs']
  .map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');

// Mocks are declared after the source so they replace the Sheet-backed
// helpers. MailApp throws: no-call mode must never reach it.
const mocks = `
var PropertiesService = { getScriptProperties: () => ({
  getProperty: k => ({ WEBHOOK_SECRET: 'test-secret', STAFF_EMAIL: '' })[k] || null,
  setProperty() {} }) };
var Utilities = { getUuid: () => 'uuid' };
var MailApp = { sendEmail() { throw new Error('mail sent in no-call mode'); } };
var ContentService = { createTextOutput: t => ({ setMimeType() { return t; } }), MimeType: { JSON: 1 } };
var Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@example.invalid' }) };
var row;
function findByRowId_(id) { return row && id === row.row_id ? row : null; }
function updateRow_(n, patch) { Object.assign(row, patch); }
function logEvent_() {}
function checkpointDueAt_(at, cp) {
  return new Date(new Date(at).getTime() - CHECKPOINT_OFFSET_HOURS[cp] * 3600e3);
}
`;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(source + '\n' + mocks, ctx);

function freshRow() {
  vm.runInContext(`row = {
    _row: 2, row_id: 'P001', patient_name: 'Alex Demo', procedure: 'Colonoscopy',
    procedure_at: new Date(Date.now() + 72 * 3600e3).toISOString(),
    checkpoint: 'T72', state: 'IN_CALL', call_id: 'call_abc',
    partial_cycles: 0, no_answer_attempts: 0, prep_snapshot: '', readiness_delta: ''
  };`, ctx);
}

function body(overrides) {
  return Object.assign({
    status: 'completed', task_completed: true, call_id: 'call_abc',
    metadata: { row_id: 'P001', checkpoint: 'T72' },
    recipients: [{ structured_result: {
      prep_status: 'partial', identity_verified: true,
      items_completed: ['stopped taking iron tablets'],
      items_outstanding: ['collected the bowel prep kit from the pharmacy']
    } }]
  }, overrides);
}

function result(fields) {
  return [{ structured_result: Object.assign({ identity_verified: true }, fields) }];
}

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name.padEnd(34), '→', actual,
    ok ? '' : `(expected ${expected})`);
}

function run(b) {
  freshRow();
  try { return ctx.handleCallResult_(b); } catch (e) { return 'THREW: ' + e.message; }
}

// ---- the one path that is allowed to dial again ----
check('genuine no_answer retries', run(body({ status: 'no_answer' })), 'no_answer');

// ---- normal progress ----
check('valid partial result', run(body({})), 'partial');

// ---- identifiers are required and must match ----
check('omitted call_id', run(body({ call_id: undefined })), 'staff_review');
check('omitted checkpoint', run(body({ metadata: { row_id: 'P001' } })), 'staff_review');
check('call_id for another call', run(body({ call_id: 'call_other' })), 'staff_review');
check('checkpoint mismatch', run(body({ metadata: { row_id: 'P001', checkpoint: 'T24' } })), 'staff_review');

// ---- status must be terminal and recognised ----
check('unknown status', run(body({ status: 'something_new' })), 'staff_review');
check('nonterminal in_progress', run(body({ status: 'in_progress' })), 'staff_review');
check('missing status', run(body({ status: '' })), 'staff_review');
check('failed is not retried', run(body({ status: 'failed' })), 'staff_review');

// ---- completed but not usable ----
check('task not completed', run(body({ task_completed: false })), 'staff_review');
check('no prep_status', run(body({ recipients: result({}) })), 'staff_review');
check('identity not verified', run(body({ recipients: [{ structured_result: { prep_status: 'partial' } }] })), 'staff_review');

// ---- outcomes that stop the workflow ----
check('asked_to_stop', run(body({ recipients: result({ prep_status: 'partial', asked_to_stop: true }) })), 'staff_review');
check('flag_for_staff', run(body({ recipients: result({ prep_status: 'partial', flag_for_staff: true }) })), 'staff_review');

// ---- a replayed result is applied once ----
freshRow();
ctx.handleCallResult_(body({}));
const cycles = vm.runInContext('row.partial_cycles', ctx);
const replay = ctx.handleCallResult_(body({}));
check('replay not applied twice', replay + ' / cycles ' + cycles, 'staff_review / cycles 1');

// ---- nothing sensitive lands in a cell ----
freshRow();
ctx.handleCallResult_(body({ recipients: result({ prep_status: 'partial',
  items_completed: ['call me on +12025550143'], items_outstanding: ['kit'] }) }));
const snap = vm.runInContext('row.prep_snapshot', ctx);
check('phone masked in prep_snapshot', /12025550143/.test(snap) ? 'raw phone stored' : 'masked', 'masked');

// ---- validation and masking helpers ----
check('E.164 accepts valid', ctx.isE164_('+12025550143'), true);
check('E.164 rejects trailing newline', ctx.isE164_('+12025550143\n'), false);
check('E.164 rejects no plus', ctx.isE164_('12025550143'), false);
check('E.164 rejects spaces', ctx.isE164_('+1 202 555 0143'), false);
check('E.164 rejects non-ASCII digit', ctx.isE164_('+1202555\u0660143'), false);
check('mask redacts token',
  /test-secret|9263393f/.test(ctx.maskFreeText_('url?token=9263393f-1c46-4517-91b7-9994099589e2', 200)) ? 'leaked' : 'redacted',
  'redacted');
check('mask redacts bearer',
  /iams_live/.test(ctx.maskFreeText_('Bearer iams_live_xWNmFGUm8Ky1cyHkWmgi', 200)) ? 'leaked' : 'redacted',
  'redacted');

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

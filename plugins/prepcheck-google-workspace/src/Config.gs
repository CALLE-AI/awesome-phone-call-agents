/**
 * PrepCheck — configuration and constants.
 *
 * Secrets live in Script Properties, never in code.
 * Set them once via setupScriptProperties() below, then delete the values
 * from the function body before committing.
 */

const CALLE_BASE_URL = 'https://api.heycall-e.com';

const SHEET_PATIENTS = 'Patients';
const SHEET_PREP = 'PrepSteps';
const SHEET_LOG = 'CallLog';

/** Clinic identity used in the call opening. */
const CLINIC_NAME = 'Northside Endoscopy Clinic';   // fictional
const CLINIC_CALLBACK = '+1 202 555 0100';          // reserved fictional block

/** Checkpoint definitions. Order matters — a patient advances down this list. */
const CHECKPOINTS = ['T72', 'T24'];

const CHECKPOINT_OFFSET_HOURS = {
  T72: 72,
  T24: 24
};

/** States. */
const STATE = {
  PENDING: 'PENDING',
  IN_CALL: 'IN_CALL',
  PARTIAL: 'PARTIAL',
  PREPARED: 'PREPARED',
  NOT_PREPARED: 'NOT_PREPARED',
  NO_ANSWER: 'NO_ANSWER',
  STAFF_REVIEW: 'STAFF_REVIEW',
  CONFIRMED: 'CONFIRMED'
};

/** Guard rails. */
const MAX_PARTIAL_CYCLES = 2;   // "I'll do it today" repeats before escalation
const MAX_NO_ANSWER_ATTEMPTS = 2;
const PARTIAL_CALLBACK_HOURS = 48;
const NO_ANSWER_RETRY_HOURS = 5;  // different time of day, not a redial

/**
 * Kill switch. Set to true to place real calls.
 *
 * Note what this does and does not do. Setting it to false stops PrepCheck
 * dispatching anything further — no new calls, no notification email. It
 * cannot recall a call CALL-E has already accepted: once the provider has the
 * task, the conversation is out of this system's hands. Treat the kill switch
 * as "place nothing more", not as "cancel what is in flight".
 */
const LIVE_CALLS_ENABLED = false;

function props_() {
  return PropertiesService.getScriptProperties();
}

function getApiKey_() {
  const k = props_().getProperty('CALLE_API_KEY');
  if (!k) throw new Error('CALLE_API_KEY not set. Run setupScriptProperties() first.');
  return k;
}

function getWebhookUrl_() {
  const u = props_().getProperty('WEBHOOK_URL');
  if (!u) throw new Error('WEBHOOK_URL not set. Deploy as web app, then store the /exec URL.');
  return u;
}

function getWebhookSecret_() {
  return props_().getProperty('WEBHOOK_SECRET') || '';
}

/**
 * Staff notification address. There is deliberately no fallback to the
 * effective user: an unconfigured install must not quietly email whoever
 * happened to run the script.
 */
function getStaffEmail_() {
  return props_().getProperty('STAFF_EMAIL') || '';
}

/**
 * ASCII E.164 only. Anything else never reaches a dispatch call.
 * Rejects Unicode digits, spaces, dashes, brackets and leading zeros.
 */
function isE164_(value) {
  const s = String(value == null ? '' : value);
  return /^\+[1-9][0-9]{7,14}$/.test(s);
}

/** Masks a phone number for logs and previews: +1202*****43 */
function maskPhone_(value) {
  const s = String(value == null ? '' : value);
  if (s.length < 7) return '***';
  return s.slice(0, 5) + '*'.repeat(Math.max(0, s.length - 7)) + s.slice(-2);
}

/**
 * Anything a caller said, or a provider returned, is untrusted free text.
 * It never lands in a log verbatim: it is truncated and stripped of
 * characters that could break out of a cell or a log line.
 */
function maskFreeText_(value, max) {
  const limit = max || 120;
  const s = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
  if (!s) return '';
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

/**
 * Run once from the editor, then blank the values out again.
 * WEBHOOK_URL is the /exec URL from Deploy > New deployment > Web app.
 * WEBHOOK_SECRET is any random string; it is appended as ?token= to the
 * webhook URL so unauthenticated posts can be rejected.
 */
function setupScriptProperties() {
  props_().setProperties({
    CALLE_API_KEY: '',
    WEBHOOK_URL: '',
    WEBHOOK_SECRET: Utilities.getUuid(),
    STAFF_EMAIL: ''
  }, false);
  Logger.log('Webhook secret: ' + getWebhookSecret_());
}

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

/**
 * Call statuses we recognise as terminal.
 *
 * Only a genuine non-contact earns another dial. A status we do not
 * recognise, or a terminal failure we cannot interpret, is not the same as
 * "nobody picked up" and must not be treated like one — an unrecognised
 * status is a gap in our understanding of the provider, and guessing at it
 * with a retry means calling a real person on the strength of a guess.
 */
const RETRYABLE_NO_CONTACT = ['no_answer', 'busy', 'voicemail', 'unreachable'];
const TERMINAL_FAILURE = ['failed', 'canceled', 'cancelled', 'declined',
                          'rejected', 'blocked'];

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
 * ASCII E.164 only, matched against the whole string.
 *
 * JavaScript's `$` anchors at end-of-input rather than before a trailing
 * newline (unlike Python and PCRE), but this does not rely on that: the
 * value is rejected outright if it carries surrounding whitespace or any
 * non-ASCII-printable character, and the match is then required to span the
 * entire string by length. Unicode digits, spaces, dashes, brackets, leading
 * zeros and stray line endings all fail.
 */
function isE164_(value) {
  const s = String(value == null ? '' : value);
  if (!s || s !== s.trim()) return false;
  if (/[^\x20-\x7E]/.test(s)) return false;
  const m = /^\+[1-9][0-9]{7,14}$/.exec(s);
  return m !== null && m[0].length === s.length;
}

/** Masks a phone number for logs and previews: +1202*****43 */
function maskPhone_(value) {
  const s = String(value == null ? '' : value);
  if (s.length < 7) return '***';
  return s.slice(0, 5) + '*'.repeat(Math.max(0, s.length - 7)) + s.slice(-2);
}

/**
 * Anything a caller said, or a provider returned, is untrusted free text and
 * may carry things that must never reach a log or a shared spreadsheet cell:
 * a phone number echoed back in an error, a token in a URL, an API key in a
 * stack trace.
 *
 * Redaction runs before truncation, so a secret cannot survive by sitting
 * past the character limit.
 */
function maskFreeText_(value, max) {
  const limit = max || 120;
  let s = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>]/g, '');

  // Credentials first: query tokens, bearer headers, and named key fields.
  s = s.replace(/([?&](?:token|key|secret|api[_-]?key|access[_-]?token)=)[^&\s"']+/gi,
                '$1[redacted]');
  s = s.replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '$1 [redacted]');
  s = s.replace(/\b((?:api[_-]?key|secret|token|password)["'\s:=]{1,4})[A-Za-z0-9._~+\/-]{8,}/gi,
                '$1[redacted]');

  // Anything shaped like a key or an id: long opaque runs and UUIDs.
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
                '[redacted-id]');
  s = s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]');

  // Phone numbers, whether E.164 or loosely formatted.
  s = s.replace(/\+[0-9][0-9\s().-]{6,17}[0-9]/g, m => maskPhone_(m.replace(/[^\d+]/g, '')));
  s = s.replace(/\b[0-9][0-9\s().-]{8,16}[0-9]\b/g, m => maskPhone_(m.replace(/[^\d]/g, '')));

  s = s.trim();
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
  // The secret is deliberately not printed. Execution logs are retained by
  // the platform and are visible to anyone with edit access to the project;
  // a shared secret does not belong in them. Read it once from
  // Project Settings → Script Properties when you need it.
  Logger.log('Script properties set. Read WEBHOOK_SECRET from ' +
    'Project Settings > Script Properties — it is not logged.');
}

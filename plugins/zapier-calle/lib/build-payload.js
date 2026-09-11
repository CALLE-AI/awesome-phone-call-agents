import { parseResultSchema } from './result-schema.js';
import { idempotencyKey } from './idempotency.js';

const E164_RE = /^\+[1-9]\d{7,14}$/;

const FALSY_DRY_RUN = new Set(['false', '0']);

// Fail closed: only an unambiguous negative places a real call. Everything
// else is a dry run - an unrecognized string, an object, a number other than
// 0, and, most importantly, *nothing at all*.
//
// Absence is the case that matters. A field that was never set, that a Zap
// mapped from an empty upstream value, or that predates this input existing
// arrives here as `undefined`, `null`, or `''`. Reading any of those as "go
// ahead and dial" means a Zap can place a real call to a real person without
// anyone ever having chosen to leave preview mode. Going live is an explicit
// act, so it takes an explicit value; anything less previews.
export function isDryRun(value) {
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    return !FALSY_DRY_RUN.has(value.trim().toLowerCase());
  }
  return true;
}

const MAX_CORRELATION_ID_LENGTH = 200;

// correlation_id is echoed back on the webhook so a user can match a call to their own
// record, so only strings and numbers are coerced into one - anything else (an object, an
// array, a boolean, NaN) has no sensible id form and would otherwise stringify to
// something meaningless like "[object Object]" or "1,2". A literal 0 is a valid id and
// must not be treated as absent, so this checks type rather than truthiness.
function normalizeCorrelationId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed.slice(0, MAX_CORRELATION_ID_LENGTH);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).slice(0, MAX_CORRELATION_ID_LENGTH);
  }
  return null;
}

export function buildPayload(inputData, extras = {}) {
  const errors = [];
  const task = typeof inputData.task === 'string' ? inputData.task.trim() : '';
  if (!task) errors.push('A call task is required.');

  const phone = typeof inputData.phone === 'string' ? inputData.phone.trim() : '';
  if (!E164_RE.test(phone)) {
    errors.push(`Recipient phone number must be E.164 format such as +15550123456.`);
  }

  const { schema, errors: schemaErrors } = parseResultSchema(inputData.result_schema);
  errors.push(...schemaErrors);

  const recipient = { phones: [phone] };
  if (inputData.region) recipient.region = String(inputData.region).trim();
  if (inputData.locale) recipient.locale = String(inputData.locale).trim();

  const payload = {
    task,
    recipients: [recipient],
    metadata: {
      source_platform: 'zapier',
      correlation_id: normalizeCorrelationId(inputData.correlation_id),
      ...(extras.zapMeta || {}),
    },
  };
  if (schema) payload.result_schema = schema;

  const key = idempotencyKey(payload);
  if (extras.webhookUrl) payload.webhook_url = extras.webhookUrl;

  return { payload, key, errors };
}

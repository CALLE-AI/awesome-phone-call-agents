import { parseResultSchema } from './result-schema.js';
import { idempotencyKey } from './idempotency.js';

const E164_RE = /^\+[1-9]\d{7,14}$/;

const FALSY_DRY_RUN = new Set(['false', '0', '']);
const TRUTHY_DRY_RUN = new Set(['true', 'yes', 'y', 'on', '1']);

// Fail closed: only an unambiguous negative places a real call. Anything else
// (an unrecognized string, an object, a number other than 0/1, ...) is treated
// as a dry run so an unclear intent never results in an unintended phone call.
export function isDryRun(value) {
  if (value === false || value === null || value === undefined) return false;
  if (value === true) return true;
  if (value === 0) return false;
  if (value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (FALSY_DRY_RUN.has(normalized)) return false;
    if (TRUTHY_DRY_RUN.has(normalized)) return true;
    return true;
  }
  return true;
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
      correlation_id: inputData.correlation_id ? String(inputData.correlation_id) : null,
      ...(extras.zapMeta || {}),
    },
  };
  if (schema) payload.result_schema = schema;

  const key = idempotencyKey(payload);
  if (extras.webhookUrl) payload.webhook_url = extras.webhookUrl;

  return { payload, key, errors };
}

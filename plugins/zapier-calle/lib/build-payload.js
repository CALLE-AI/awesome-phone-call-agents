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

export const INPUT_FIELDS = [
  {
    key: 'task',
    label: 'Call Task',
    type: 'text',
    required: true,
    helpText:
      'What CALL-E should accomplish on the call, including any details the agent needs and exactly what information to collect.',
  },
  {
    key: 'phone',
    label: 'Recipient Phone Number',
    type: 'string',
    required: true,
    helpText: 'Must be E.164 format, for example +15550123456. Only call numbers you are authorized to call.',
  },
  {
    key: 'region',
    label: 'Region',
    type: 'string',
    required: false,
    helpText: 'Optional ISO country code such as US. Leave blank if unknown; it is never inferred.',
  },
  {
    key: 'locale',
    label: 'Locale',
    type: 'string',
    required: false,
    helpText: 'Optional locale such as en-US. Leave blank if unknown; it is never inferred.',
  },
  {
    key: 'result_schema',
    label: 'Result Schema (JSON)',
    type: 'text',
    required: false,
    helpText:
      'Optional JSON Schema describing the structured result to extract. Supported: type, properties, required, enum, nested objects, array items, description, additionalProperties false. Not supported: $ref, oneOf, anyOf, allOf.',
  },
  {
    key: 'correlation_id',
    label: 'Correlation ID',
    type: 'string',
    required: false,
    helpText: 'Your own record ID. Echoed back on the result so you can write the outcome to the right row.',
  },
  {
    key: 'dry_run',
    label: 'Dry Run',
    type: 'boolean',
    required: false,
    default: 'false',
    helpText:
      'When true, returns a masked preview and places no call. Any unrecognized value is also treated as a dry run so no unintended call is placed.',
  },
];

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

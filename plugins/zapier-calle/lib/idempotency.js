import { createHash } from 'node:crypto';

const CANONICAL_FIELDS = [
  'task',
  'recipients',
  'result_schema',
  'recipient_result_schema',
  'metadata',
];

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function idempotencyKey(payload) {
  const subset = {};
  for (const field of CANONICAL_FIELDS) {
    subset[field] = payload[field] === undefined ? null : payload[field];
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(subset))).digest('hex');
}

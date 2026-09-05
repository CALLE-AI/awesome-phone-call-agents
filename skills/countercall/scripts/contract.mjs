/**
 * contract.mjs — the pinned result contract, and validation against it.
 *
 * No network. No side effects. This module is the single source of truth for the shape
 * CounterCall expects back from a Goal Run; preflight, call and bench all import it rather
 * than restating it.
 *
 * ## Why the shape looks like this
 *
 * A Goal Run `result` is a FLAT MAP OF SCALARS. From the CALL-E OpenAPI spec:
 *
 *     result:
 *       type: [object, "null"]
 *       additionalProperties:
 *         $ref: "#/components/schemas/GoalScalar"    # string | number | boolean
 *
 * No arrays. No nested objects. No nulls. This is a Goals-API constraint specifically —
 * the one-shot Calls API does support `simple array.items` in its request-scoped
 * result_schema, but Goals does not, and Goals is what gives us the published, reusable
 * procedure library.
 *
 * Two consequences, both deliberate:
 *
 * 1. `required_documents_text` is a newline-separated STRING, decoded client-side by
 *    `decodeDocuments`. A document checklist is the product, so it does not get to be
 *    unrepresentable.
 * 2. `total_fee_idr` is OPTIONAL rather than nullable. `null` is not a GoalScalar, but
 *    absence is free: a field that is not in `required` is simply missing when the clerk
 *    did not know. The rule from references/safety.md survives intact — a missing fee is
 *    missing, never `0`, and never a typical value.
 */

/** Bump `version` to match the Goal's published_run_spec version after each publish. */
export const CONTRACT = {
  version: 1,

  required: [
    'required_documents_text',
    'payment_method',
    'appointment_required',
    'originals_or_copies',
    'clerk_certainty',
    'clerk_quote',
  ],

  optional: ['total_fee_idr'],

  enums: {
    payment_method: ['cash', 'card', 'both', 'unknown'],
    appointment_required: ['yes', 'no', 'unknown'],
    originals_or_copies: ['originals', 'copies', 'both', 'unknown'],
    clerk_certainty: ['confident', 'unsure', 'refused'],
  },
};

/** Every key the contract allows, required first. Used for the drift diff. */
export function contractFields() {
  return [...CONTRACT.required, ...CONTRACT.optional];
}

/**
 * Decode the newline-separated document list into the array the card renders.
 * Blank lines and bullet leaders are dropped; nothing else is normalised, because
 * the clerk's own terms are the point.
 */
export function decodeDocuments(text) {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Validate a Goal Run result against the pinned contract.
 * Returns an array of problems; empty means valid. A non-empty return must route to
 * `result_invalid` and render nothing — a partial checklist is worse than no checklist.
 */
export function validateResult(result) {
  const problems = [];

  if (result === null || result === undefined) return ['result is null'];
  if (typeof result !== 'object' || Array.isArray(result)) return ['result is not an object'];

  for (const field of CONTRACT.required) {
    if (!(field in result)) problems.push(`missing required field: ${field}`);
  }

  // additionalProperties: false — an unexpected key is drift, not a curiosity.
  const allowed = new Set(contractFields());
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) problems.push(`unexpected field: ${key}`);
  }

  for (const [field, values] of Object.entries(CONTRACT.enums)) {
    if (!(field in result)) continue;
    if (!values.includes(result[field])) {
      problems.push(`${field} not in enum: ${JSON.stringify(result[field])}`);
    }
  }

  if ('required_documents_text' in result) {
    if (typeof result.required_documents_text !== 'string') {
      problems.push('required_documents_text is not a string');
    } else if (decodeDocuments(result.required_documents_text).length === 0) {
      problems.push('required_documents_text decodes to zero documents');
    }
  }

  if ('clerk_quote' in result) {
    if (typeof result.clerk_quote !== 'string') {
      problems.push('clerk_quote is not a string');
    } else if (result.clerk_quote.trim().length === 0) {
      // The quote is span grounding — it is the evidence for every other field. An empty
      // one renders a card that looks sourced and is not.
      problems.push('clerk_quote is empty');
    }
  }

  if ('total_fee_idr' in result) {
    const fee = result.total_fee_idr;
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      problems.push('total_fee_idr is present but not a finite number');
    } else if (fee < 0) {
      problems.push('total_fee_idr is negative');
    }
  }

  return problems;
}

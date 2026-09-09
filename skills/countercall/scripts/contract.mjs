/**
 * contract.mjs — the pinned result contract, and validation against it.
 *
 * No network. No side effects. This module is the single source of truth for the shape
 * CounterCall expects back from CALL-E; preflight, call, bench and both transports import
 * it rather than restating it.
 *
 * ## One contract, two transports
 *
 * CounterCall can reach CALL-E two ways, and the validated result shape is IDENTICAL on
 * both. That is the whole point of this file.
 *
 * - **Goals transport** — a published Goal owns the schema. We diff our pinned copy against
 *   the live `published_run_spec` and refuse to dial on any drift.
 * - **Calls transport** — no published Goal exists, so we send the schema with the request
 *   (`result_schema`). Drift is impossible by construction: `resultSchemaJSON()` below is
 *   generated from the same `CONTRACT` that `validateResult` checks against.
 *
 * The Calls transport is not a downgrade. It exists because publishing a Goal is reachable
 * only through CALL-E Chat — no API, no MCP tool, no UI button (see FEEDBACK.md finding 5)
 * — and CALL-E suspended account logins after a security incident on 2026-09-02. A demo
 * path that a vendor outage can sever is not a demo path.
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
 * No arrays. No nested objects. No nulls. The one-shot Calls API is more permissive — it
 * does support `simple array.items` — but we deliberately keep the SCALAR shape on both
 * transports. A checklist that changes type depending on how it was fetched would need two
 * validators, two renderers and two sets of tests, and would let a card render correctly on
 * one path and wrongly on the other. One shape, one validator, one card.
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

  /*
   * Descriptions are sent to CALL-E's extraction model on the Calls transport and guide how
   * it reads the transcript. The docs are explicit that they steer extraction but are NOT
   * validation — `type`, `required`, `enum` and `additionalProperties` do the enforcing, and
   * `validateResult` below re-checks all four locally regardless. These are written for a
   * clerk who is rushed, on a bad line, and under no obligation to help.
   */
  descriptions: {
    required_documents_text:
      'Every document the clerk said to bring, one per line, in the clerk\'s own words and ' +
      'in Indonesian. Do not translate, renumber, deduplicate or add documents the clerk did ' +
      'not name. If the clerk named no documents, this call has no usable answer.',
    payment_method:
      'How the fee is paid at the counter. Use "both" only if the clerk said both are ' +
      'accepted. Use "unknown" if the clerk did not say, was unsure, or the fee never came up.',
    appointment_required:
      'Whether the applicant must book or register before arriving. Use "unknown" if the ' +
      'clerk did not say or was unsure.',
    originals_or_copies:
      'Whether the documents must be originals, photocopies, or both. Use "unknown" if the ' +
      'clerk did not say. This is the single most commonly omitted requirement and the most ' +
      'common reason someone is sent home, so do not infer it.',
    clerk_certainty:
      'How the clerk delivered the answer. Use "confident" when they answered directly. Use ' +
      '"unsure" when they hedged, guessed, or told the caller to confirm at the counter. Use ' +
      '"refused" when they declined to answer by phone or redirected without answering.',
    clerk_quote:
      'One short verbatim sentence from the clerk, in Indonesian, that most directly ' +
      'supports the fields above. This is the evidence for the whole card. Quote the clerk, ' +
      'never the caller, and never paraphrase.',
    total_fee_idr:
      'The total fee in Indonesian rupiah as a plain number, with no separators or currency ' +
      'symbol. OMIT THIS FIELD ENTIRELY if the clerk did not state a fee or was unsure. ' +
      'Never guess, never use a typical value, and never send 0 to mean unknown.',
  },
};

/**
 * Emit the contract as a JSON Schema for the Calls transport's request-scoped
 * `result_schema`.
 *
 * Generated from `CONTRACT`, never hand-written, so the schema CALL-E validates against on
 * the server and the one `validateResult` enforces here cannot drift apart. Only the schema
 * features the Calls API documents as supported are used: type, properties, required, enum,
 * description, additionalProperties: false. No $ref, no oneOf, no format.
 */
export function resultSchemaJSON() {
  const properties = {};
  for (const field of contractFields()) {
    const property = { type: field === 'total_fee_idr' ? 'number' : 'string' };
    if (CONTRACT.enums[field]) property.enum = [...CONTRACT.enums[field]];
    if (CONTRACT.descriptions[field]) property.description = CONTRACT.descriptions[field];
    properties[field] = property;
  }
  return {
    type: 'object',
    required: [...CONTRACT.required],
    properties,
    additionalProperties: false,
  };
}

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

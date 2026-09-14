/**
 * CALL-E's `result_schema` accepts a *subset* of JSON Schema. Sending anything
 * outside it comes back as `result_schema_invalid` — at dispatch time, after the
 * user has already asked for the work. So we validate our schemas locally, and a
 * unit test asserts every shipped schema passes.
 *
 * Supported:   type (object|string|number|integer|boolean|array), properties,
 *              required, enum, nested objects, simple array.items, description,
 *              additionalProperties:false
 * Unsupported: $ref, oneOf, anyOf, allOf, recursion, complex format,
 *              additionalProperties:true
 *
 * This is also why we hand-write these schemas rather than deriving them from
 * Zod — z.toJSONSchema emits $ref/anyOf for perfectly ordinary shapes.
 */

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  description?: string;
  additionalProperties?: boolean;
};

const ALLOWED_KEYS = new Set([
  'type',
  'properties',
  'required',
  'enum',
  'items',
  'description',
  'additionalProperties',
]);

const ALLOWED_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

/** Field names CALL-E reserves on recipient results; colliding is rejected upstream. */
export const RESERVED_RECIPIENT_FIELDS = new Set([
  'summary',
  'status',
  'transcript',
  'call_id',
  'started_at',
  'completed_at',
  'duration',
  'duration_seconds',
]);

export function assertCalleSchemaSupported(schema: JsonSchema, path = 'root'): void {
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Unsupported JSON Schema keyword "${key}" at ${path}.`);
    }
  }
  if (schema.type !== undefined && !ALLOWED_TYPES.has(schema.type)) {
    throw new Error(`Unsupported JSON Schema type "${schema.type}" at ${path}.`);
  }
  if (schema.additionalProperties === true) {
    throw new Error(`additionalProperties:true is not supported at ${path}.`);
  }
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      assertCalleSchemaSupported(child, `${path}.${key}`);
    }
  }
  if (schema.items) assertCalleSchemaSupported(schema.items, `${path}[]`);
  if (schema.required) {
    for (const name of schema.required) {
      if (!schema.properties || !(name in schema.properties)) {
        throw new Error(`required lists "${name}" which is not a property at ${path}.`);
      }
    }
  }
}

export function assertNoReservedRecipientFields(schema: JsonSchema, path = 'root'): void {
  for (const key of Object.keys(schema.properties ?? {})) {
    if (RESERVED_RECIPIENT_FIELDS.has(key)) {
      throw new Error(`"${key}" is reserved by CALL-E and cannot be a recipient result field (${path}).`);
    }
  }
}

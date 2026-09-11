/**
 * Enforcement of CALL-E's supported JSON Schema subset.
 *
 * CALL-E validates `result_schema` and `recipient_result_schema` server side and rejects
 * — or silently nulls out the result of — anything outside the subset. This runs before a
 * request is ever sent, so an unsupported construct surfaces at compile time rather than
 * at demo time. See TECHNICAL_ARCH.md section 4.5.
 */

const SUPPORTED_TYPES = [
  "object",
  "string",
  "number",
  "integer",
  "boolean",
  "array",
] as const;

/** Keywords CALL-E rejects outright. */
const REJECTED_KEYWORDS = ["$ref", "oneOf", "anyOf", "allOf"] as const;

/**
 * Recipient field names CALL-E reserves on its own recipient objects. Only relevant to
 * `recipient_result_schema`, which Veyra does not currently use.
 */
export const RESERVED_RECIPIENT_FIELDS = [
  "summary",
  "status",
  "transcript",
  "call_id",
  "started_at",
  "completed_at",
  "duration",
] as const;

export class CalleSchemaError extends Error {
  constructor(
    message: string,
    /** JSON-pointer-ish path to the offending keyword, e.g. "properties.goal.items". */
    readonly path: string,
  ) {
    super(`${message} (at ${path || "root"})`);
    this.name = "CalleSchemaError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Throws CalleSchemaError if `schema` uses anything CALL-E does not support.
 * Call this on every compiled result schema before dispatch.
 */
export function assertCalleSchemaSubset(schema: unknown, path = ""): void {
  if (!isPlainObject(schema)) {
    throw new CalleSchemaError("Schema must be a JSON object", path);
  }

  for (const keyword of REJECTED_KEYWORDS) {
    if (keyword in schema) {
      throw new CalleSchemaError(`CALL-E does not support "${keyword}"`, path);
    }
  }

  if (schema.additionalProperties === true) {
    throw new CalleSchemaError(
      'CALL-E does not support "additionalProperties: true"',
      path,
    );
  }

  const type = schema.type;
  if (typeof type !== "string") {
    throw new CalleSchemaError(
      'Every schema node needs a single string "type"',
      path,
    );
  }
  if (!SUPPORTED_TYPES.includes(type as (typeof SUPPORTED_TYPES)[number])) {
    throw new CalleSchemaError(
      `Unsupported type "${type}", expected one of ${SUPPORTED_TYPES.join(", ")}`,
      path,
    );
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new CalleSchemaError('"enum" must be an array', path);
  }

  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    throw new CalleSchemaError('"required" must be an array of field names', path);
  }

  if (type === "object") {
    if (!isPlainObject(schema.properties)) {
      throw new CalleSchemaError('An object schema needs "properties"', path);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      assertCalleSchemaSubset(child, path ? `${path}.properties.${key}` : key);
    }
  }

  if (type === "array") {
    if (Array.isArray(schema.items)) {
      throw new CalleSchemaError(
        "CALL-E supports simple array.items only, not tuple forms",
        path,
      );
    }
    if (schema.items === undefined) {
      throw new CalleSchemaError('An array schema needs "items"', path);
    }
    assertCalleSchemaSubset(schema.items, `${path}.items`);
  }
}

/**
 * Guards a `recipient_result_schema` against CALL-E's reserved recipient field names.
 * Only needed if a future feature batches identical-task calls to multiple contacts.
 */
export function assertNoReservedRecipientFields(schema: unknown): void {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return;
  for (const name of Object.keys(schema.properties)) {
    if (RESERVED_RECIPIENT_FIELDS.includes(name as (typeof RESERVED_RECIPIENT_FIELDS)[number])) {
      throw new CalleSchemaError(
        `"${name}" is reserved by CALL-E on recipient objects`,
        `properties.${name}`,
      );
    }
  }
}

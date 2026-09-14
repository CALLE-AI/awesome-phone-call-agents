import assert from "node:assert/strict";

// CALL-E documents a restricted subset, not arbitrary JSON Schema support.
export function assertCalleSchema(schema) {
  const allowed = new Set(["type", "properties", "required", "enum", "items", "description", "additionalProperties"]);
  for (const key of Object.keys(schema)) assert.ok(allowed.has(key), `Unsupported CALL-E schema keyword: ${key}`);
  assert.ok(["object", "array", "string", "number", "integer", "boolean"].includes(schema.type), "CALL-E schema types must be singular");
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    for (const field of schema.required || []) assert.ok(Object.hasOwn(schema.properties, field));
    Object.values(schema.properties).forEach(assertCalleSchema);
  }
  if (schema.type === "array") assertCalleSchema(schema.items);
}

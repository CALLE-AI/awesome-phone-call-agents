import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";

// Ajv and ajv-formats are CJS modules whose default-export interop is
// inconsistent under NodeNext. Loading them through createRequire returns the
// constructable class / callable plugin directly, then we cast to the correct
// types for full type-safety.
const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

/** Shared Ajv instance for strict local validation of CALL-E structured results. */
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

export function compile(schema: Record<string, unknown>): ValidateFunction {
  return ajv.compile(schema);
}

export function runValidator(
  validate: ValidateFunction,
  data: unknown,
): ValidationOutcome {
  const valid = validate(data) as boolean;
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`.trim(),
  );
  return { valid: false, errors };
}

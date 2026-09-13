// scripts/validate-schema.ts
// Validates fixture JSON files against schema definitions.
// No external dependencies.
//
// Usage:
//   npm run validate-schema

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const lossFixture = require("./fixtures/loss-report-result.json");
const coverageFixture = require("./fixtures/coverage-verify-result.json");
const schema = require(join(__dirname, "../../../skills/insurance-claims-orchestrator/references/schema.json"));

type FieldSchema = { type?: string | string[]; enum?: string[] };
type SchemaDefinition = {
  required?: string[];
  properties?: Record<string, FieldSchema>;
};

function validateAgainstDefinition(
  data: Record<string, unknown>,
  definition: SchemaDefinition,
  label: string
): boolean {
  let passed = true;
  for (const field of definition.required ?? []) {
    if (!(field in data)) {
      console.error(`  FAIL [${label}]: missing required field "${field}"`);
      passed = false;
    }
  }
  for (const [field, fieldSchema] of Object.entries(definition.properties ?? {})) {
    const value = data[field];
    if (fieldSchema.enum && value !== undefined && value !== null) {
      if (!fieldSchema.enum.includes(value as string)) {
        console.error(
          `  FAIL [${label}]: "${field}" value "${value}" not in enum ${JSON.stringify(fieldSchema.enum)}`
        );
        passed = false;
      }
    }
  }
  return passed;
}

function main(): void {
  console.log("=== Validating fixtures against schema.json ===\n");
  const defs = schema.definitions as Record<string, SchemaDefinition>;
  let allPassed = true;

  console.log("Validating loss-report-result.json...");
  const lossOk = validateAgainstDefinition(
    lossFixture.structured_result as Record<string, unknown>,
    defs.LossReportResult,
    "LossReportResult"
  );
  console.log(lossOk ? "  PASS\n" : "  (see errors above)\n");
  allPassed = allPassed && lossOk;

  console.log("Validating coverage-verify-result.json...");
  const coverageOk = validateAgainstDefinition(
    coverageFixture.structured_result as Record<string, unknown>,
    defs.CoverageVerifyResult,
    "CoverageVerifyResult"
  );
  console.log(coverageOk ? "  PASS\n" : "  (see errors above)\n");
  allPassed = allPassed && coverageOk;

  if (allPassed) {
    console.log("✅ All fixtures valid.");
  } else {
    console.error("❌ Validation failed — see errors above.");
    process.exit(1);
  }
}

main();

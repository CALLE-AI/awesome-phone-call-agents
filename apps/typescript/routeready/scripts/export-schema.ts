// Writes READINESS_SCHEMA to the route-readiness-call skill so the skill and
// the app always publish the same result schema. tests/schema.test.ts fails
// when they drift. Usage: npm run export:schema
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { READINESS_SCHEMA } from "../src/calle/task.js";

const target = fileURLToPath(new URL("../../../../skills/route-readiness-call/references/result-schema.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(READINESS_SCHEMA, null, 2)}\n`);
console.log(`Wrote ${target}`);

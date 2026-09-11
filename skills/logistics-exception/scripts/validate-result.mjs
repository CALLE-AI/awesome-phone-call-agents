#!/usr/bin/env node
// Offline validator for a CALL-E recipient result against the logistics-exception schema.
// No network, no credentials, no call. Usage: node scripts/validate-result.mjs <result.json>
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, "../references/result-schema.json"), "utf8"));
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/validate-result.mjs <result.json>");
  process.exit(2);
}
const result = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
const errors = [];
if (typeof result !== "object" || result === null || Array.isArray(result)) errors.push("result must be an object");
else {
  for (const key of Object.keys(result)) if (!schema.properties[key]) errors.push(`unexpected field: ${key}`);
  for (const key of schema.required) if (!(key in result)) errors.push(`missing field: ${key}`);
  for (const [key, def] of Object.entries(schema.properties)) {
    if (!(key in result)) continue;
    const value = result[key];
    if (typeof value !== "string") errors.push(`${key} must be a string`);
    else if (def.enum && !def.enum.includes(value)) errors.push(`${key} must be one of ${def.enum.join(", ")}`);
  }
}
if (errors.length) {
  console.error("INVALID");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
const unresolved = (v) => v.trim() === "" || v.trim().toLowerCase() === "unknown";
const clock = /^(?:(?:at|around|by|approximately)\s+)?(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?$/i;
const usable = result.reached === "yes" && result.shipment_recognized !== "no";
console.log(`VALID (${usable ? "may contribute facts" : "cannot contribute facts: reached=" + result.reached + ", shipment_recognized=" + result.shipment_recognized})`);
for (const key of schema.required) {
  const value = result[key];
  let note = unresolved(value) ? "unresolved" : "resolved";
  if (key === "revised_eta" && !unresolved(value)) note += clock.test(value.trim()) ? " (exact clock time)" : " (not an exact clock time; not comparable)";
  console.log(` ${key.padEnd(20)} ${JSON.stringify(value).padEnd(48)} ${note}`);
}

/**
 * Promotes a captured run to the replay fallback.
 *
 *   npm run replay:promote -- data/captures/<timestamp>.json
 *
 * Writes the gitignored fixtures/golden-run.json for local replay.
 * Captured transcripts can contain personal information even after phone redaction.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Call } from "@call-e/calle";
import clarifications from "../fixtures/demo-clarifications.json" with { type: "json" };
import { formatOffset, normalizeCall } from "../lib/call-record";

/**
 * Replace recipient and attempt phone fields before writing the local fixture.
 */
const PLACEHOLDER_E164 = "+15555550100";

function redactPhones(call: Call): Call {
  return {
    ...call,
    recipients: call.recipients.map((recipient) => ({
      ...recipient,
      phones: recipient.phones.map(() => PLACEHOLDER_E164),
      attempts: recipient.attempts.map((attempt) => ({ ...attempt, phone: PLACEHOLDER_E164 })),
    })),
  };
}

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run replay:promote -- data/captures/<timestamp>.json");
  process.exit(1);
}

const raw = JSON.parse(await fs.readFile(source, "utf8")) as Call;
const call = redactPhones(raw);
const record = normalizeCall(call);

if (record.status !== "completed") {
  console.error(`Refusing to promote: status is ${record.status}, not completed.`);
  process.exit(1);
}
if (!record.structuredResult) {
  console.error("Refusing to promote: the run has no structuredResult.");
  process.exit(1);
}

const primaryId = clarifications[0]!.id;
if (Object.keys(record.structuredResult).length !== 1 || !record.structuredResult[primaryId]) {
  console.error("Refusing to promote: the result must answer the seeded primary clarification.");
  process.exit(1);
}

// Validate before writing so a rejected capture never leaves private data on disk.
const leaked = [...JSON.stringify(call).matchAll(/\+[1-9]\d{7,14}/g)]
  .some((match) => match[0] !== PLACEHOLDER_E164);
if (leaked) {
  console.error("Refusing to promote: a phone number remains outside the redacted phone fields.");
  process.exit(1);
}

const out = path.join(process.cwd(), "fixtures", "golden-run.json");
await fs.writeFile(
  out,
  JSON.stringify(
    { note: `Real captured call, promoted from ${path.basename(source)}.`, synthetic: false, clarifications, call },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`Promoted ${source} → fixtures/golden-run.json`);
console.log(`  ${record.transcript.length} turns, ${Object.keys(record.structuredResult).length} clarifications answered`);
const last = record.transcript.at(-1)?.offsetSeconds ?? null;
console.log(`  conversation length: ${formatOffset(last) ?? "unknown"}`);

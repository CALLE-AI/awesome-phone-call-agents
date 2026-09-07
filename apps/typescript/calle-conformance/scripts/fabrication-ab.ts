/**
 * Does the schema description stop the platform from inventing a result?
 *
 * A call to a non-routable number produced structuredResult {"answered":"no"}
 * with zero transcript turns. Four calls to a number that stopped answering
 * produced {"heard_clearly":"unknown"} under the same conditions. Two things
 * differed between them: the field name and the presence of a description
 * saying when to use the unknown value.
 *
 * This probe removes the first difference. Same field name, same enum, same
 * task, same destination. The only variable is the description.
 *
 * Both calls go to +14155550100, a number reserved by the ITU for fiction. It
 * cannot be routed and it rings for nobody, so the experiment needs no
 * receiving infrastructure and disturbs no person. Each call still consumes
 * one from the account allowance.
 *
 * Run with --i-understand-this-places-real-calls.
 */

import { CalleClient } from "@call-e/calle";
import { writeFile } from "node:fs/promises";

const DEAD_NUMBER = "+14155550100";

const TASK =
  "Ask whether the person can hear the call clearly, thank them, and end the call.";

const withoutDescription = {
  type: "object",
  required: ["heard_clearly"],
  properties: {
    heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] },
  },
  additionalProperties: false,
};

const withDescription = {
  type: "object",
  required: ["heard_clearly"],
  properties: {
    heard_clearly: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use unknown when the recipient did not answer the question.",
    },
  },
  additionalProperties: false,
};

const variants = [
  { label: "no-description", schema: withoutDescription },
  { label: "with-description", schema: withDescription },
];

const apiKey = process.env.CALLE_API_KEY ?? "";
if (apiKey === "") throw new Error("CALLE_API_KEY must be set.");
if (!process.argv.includes("--i-understand-this-places-real-calls")) {
  throw new Error(
    "This probe places two real calls against the account allowance. " +
      "Re-run with --i-understand-this-places-real-calls.",
  );
}

const client = new CalleClient({ apiKey });
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const results: unknown[] = [];

for (const variant of variants) {
  process.stdout.write(`\n[${variant.label}] -> ${DEAD_NUMBER}\n`);

  const created = await client.calls.create(
    {
      task: TASK,
      recipients: [{ phones: [DEAD_NUMBER], region: "US", locale: "en-US" }],
      recipientResultSchema: variant.schema,
      metadata: { probe: "fabrication-ab", variant: variant.label, run: runId },
    },
    { idempotencyKey: `fabrication-ab-${variant.label}-${runId}` },
  );

  let call = created;
  for (let i = 0; i < 24; i += 1) {
    if (call.status !== "queued" && call.status !== "in_progress") break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    call = await client.calls.get(created.id);
  }

  const recipient = call.recipients[0];
  const attempt = recipient?.attempts.at(-1);
  const turns = attempt?.transcriptTurns.length ?? 0;

  process.stdout.write(`  status           ${call.status}\n`);
  process.stdout.write(`  failureCode      ${JSON.stringify(attempt?.failureCode ?? null)}\n`);
  process.stdout.write(`  transcript turns ${turns}\n`);
  process.stdout.write(`  structuredResult ${JSON.stringify(recipient?.structuredResult ?? null)}\n`);
  process.stdout.write(`  taskCompleted    ${String(call.taskCompleted)}\n`);

  results.push({ variant: variant.label, schema: variant.schema, call });
}

const path = `probe-results/EVIDENCE-fabrication-ab-${runId}.json`;
await writeFile(
  path,
  JSON.stringify({ captured: new Date().toISOString(), task: TASK, destination: DEAD_NUMBER, results }, null, 2),
  "utf8",
);
process.stdout.write(`\nSaved to ${path}\n`);

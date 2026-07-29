/**
 * Runs the whole gate against the local fake CALL-E, with no credentials and no
 * phone line. It is the fastest way to see what the gate does before you point
 * it at a real number.
 *
 *   npm run demo
 *
 * Records land in results/audit.jsonl, are verified and then a forged copy is
 * checked to show what verification actually catches.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashRecord, readRecords, verifyAudit, verifyRecords } from "../src/audit.js";
import { createSdkPort } from "../src/calle.js";
import { loadRequest } from "../src/config.js";
import { renderResult } from "../src/format.js";
import { runGate } from "../src/gate.js";
import type { AuditRecord } from "../src/types.js";
import { startFakeCalle, type FakeScenario } from "../fake/calle-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const auditFile = join(appRoot, "results", "audit.jsonl");

/** One code per approver, so an approval recorded on one handset cannot come from another. */
const CODES: Record<string, string> = {
  "release-owner": "472913",
  "backup-owner": "819274",
};
const PHRASE = ["anchor", "cobalt", "meadow"];

const OWNER = "+14155550100";
const BACKUP = "+14155550101";

interface DemoCase {
  title: string;
  note: string;
  scenarios: FakeScenario[];
}

const cases: DemoCase[] = [
  {
    title: "1. The release owner picks up and approves",
    note: "Reads the code back, says approve. The gate exits 0 and the pipeline continues.",
    scenarios: [
      {
        phone: OWNER,
        userLines: ["Hello?", "Four seven two nine one three. I approve."],
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "Said approve." },
        confidence: { score: 0.94, label: "high" },
      },
    ],
  },
  {
    title: "2. A yes with no code, then a backup who does not pick up",
    note: "Sounding willing is not approving. The gate moves down the ladder and still exits 20.",
    scenarios: [
      {
        phone: OWNER,
        userLines: ["Yeah sure, go ahead, ship it."],
        structuredResult: { decision: "approve", spoken_code: "", reason: "Said go ahead." },
      },
      { phone: BACKUP, status: "failed", failureCode: "no_answer", transcript: false },
    ],
  },
  {
    title: "3. The owner does not pick up, the backup approves",
    note: "The ladder moves on after a no answer and stops at the first real decision.",
    scenarios: [
      { phone: OWNER, status: "failed", failureCode: "no_answer", transcript: false },
      {
        phone: BACKUP,
        userLines: ["Bo speaking.", "Code eight one nine two seven four, approved."],
        structuredResult: { decision: "approve", spoken_code: "819274", reason: "Said approved." },
      },
    ],
  },
];

function forge(record: AuditRecord): AuditRecord {
  const base = { ...record, verdict: "approved" as const, approved_by: ["release-owner"] };
  const { hash: _replaced, ...unhashed } = base;
  return { ...unhashed, hash: hashRecord(unhashed) };
}

async function main(): Promise<void> {
  mkdirSync(dirname(auditFile), { recursive: true });
  if (existsSync(auditFile)) {
    rmSync(auditFile);
  }
  const request = loadRequest(join(appRoot, "examples", "request.example.json"));

  for (const demo of cases) {
    process.stdout.write(`\n${demo.title}\n${"-".repeat(demo.title.length)}\n${demo.note}\n\n`);
    const fake = await startFakeCalle(demo.scenarios);
    const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
    const result = await runGate({
      request,
      port,
      auditPath: auditFile,
      pollIntervalMs: 5,
      makeSecret: (approver) => ({ code: CODES[approver.id] ?? "000000", phrase: PHRASE }),
      onProgress: (line) => process.stdout.write(`  ${line}\n`),
      onSecret: (approver, display) =>
        process.stdout.write(`  Approval code for ${approver.name} (${approver.id}): ${display}\n`),
    });
    await fake.close();
    process.stdout.write(`\n${renderResult(result)}\n`);
  }

  const verification = verifyAudit(auditFile);
  process.stdout.write(
    `\n4. The record chain\n-------------------\n${verification.records} record(s): ${
      verification.ok ? "chain and verdicts hold" : "PROBLEMS FOUND"
    }\n`,
  );
  for (const issue of verification.issues) {
    process.stdout.write(`  record ${issue.seq}: ${issue.problem}\n`);
  }

  const records = readRecords(auditFile);
  const forged = forge(records[1]!);
  const forgedCheck = verifyRecords([records[0]!, forged]);
  process.stdout.write(
    `\n5. Same chain, one verdict rewritten from not_approved to approved, hash recomputed\n`,
  );
  process.stdout.write(`   verified: ${forgedCheck.ok}\n`);
  for (const issue of forgedCheck.issues) {
    process.stdout.write(`   record ${issue.seq}: ${issue.problem}\n`);
  }
  process.stdout.write(`\nRecords written to ${auditFile}\n`);
}

await main();

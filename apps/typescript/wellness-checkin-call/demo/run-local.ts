/**
 * Runs three check-ins against a local fake CALL-E, with no credentials and
 * no phone line: an "ok" result, a "mild_concern" result, and an "escalate"
 * result from a no-answer.
 *
 *   npm run demo
 */
import { createSdkPort } from "../src/calle.js";
import { runCheckin } from "../src/checkin.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";

const PHONE = "+12025550142";

function heading(title: string): void {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
}

async function runOne(script: FakeScript) {
  const fake = await startFakeCalle([script]);
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  const report = await runCheckin({
    request: { workflow_id: "demo", phone: PHONE, recipient_or_caregiver_opted_in: true },
    port,
    pollIntervalMs: 5,
    onProgress: (line) => process.stdout.write(`  ${line}\n`),
  });
  await fake.close();
  return report;
}

async function main(): Promise<void> {
  heading("1. Everything is fine");
  const ok = await runOne({
    phone: PHONE,
    structuredResult: {
      answered: true,
      condition_summary: "feeling good today",
      meal_status: "good",
      concerns_reported: false,
    },
  });
  process.stdout.write(`  level: ${ok.level}\n  reasons: ${ok.reasons.join("; ")}\n`);

  heading("2. A reported concern, on its own");
  const mild = await runOne({
    phone: PHONE,
    structuredResult: {
      answered: true,
      condition_summary: "feeling fine",
      meal_status: "good",
      concerns_reported: true,
      concerns_detail: "the porch light bulb burned out",
    },
  });
  process.stdout.write(`  level: ${mild.level}\n  reasons: ${mild.reasons.join("; ")}\n`);

  heading("3. No answer at all");
  const escalate = await runOne({
    phone: PHONE,
    structuredResult: { answered: false },
  });
  process.stdout.write(`  level: ${escalate.level}\n  reasons: ${escalate.reasons.join("; ")}\n`);

  process.stdout.write("\nNo real call was placed in any of these three runs.\n");
}

await main();

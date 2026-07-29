/**
 * Runs the whole errand against a local fake CALL-E, with no credentials and no
 * phone line.
 *
 *   npm run demo
 *
 * Four beats: an errand that works, a business that refuses to deal with an
 * automated caller, a time the caller was not allowed to accept and the three
 * privacy gates.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkPort } from "../src/calle.js";
import { ConfigError, loadRequest, parseRequest } from "../src/config.js";
import { PreflightError, runErrand } from "../src/errand.js";
import { renderReport, writeReport } from "../src/report.js";
import type { ErrandReport } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const results = join(appRoot, "results");
const CLINIC = "+14155550122";

const BOT_LINES = [
  "Hello, I am an automated assistant calling on behalf of Fatima Haddad, with their permission. I am not a person. I have one short administrative request.",
  "I am calling to book a routine check-up for Fatima Haddad, who is a new patient. What is the earliest appointment you have?",
  "Her date of birth is 12 April 1990.",
  "Thursday the thirteenth at nine forty in the morning works. Can you hold it? And do you take Blue Shield PPO?",
  "Thank you. What should she bring to a first appointment?",
];

function heading(title: string): void {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
}

async function run(scripts: FakeScript[], request = loadRequest(join(appRoot, "examples", "errand.example.json"))) {
  const fake = await startFakeCalle(scripts);
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  const report = await runErrand({
    request,
    port,
    pollIntervalMs: 5,
    onProgress: (line) => process.stdout.write(`  ${line}\n`),
  });
  await fake.close();
  return { report, created: fake.created.length };
}

async function main(): Promise<void> {
  mkdirSync(results, { recursive: true });

  heading("1. The errand a person could not make themselves");
  const good = await run([
    {
      phone: CLINIC,
      botLines: BOT_LINES,
      userLines: [
        "Bayview Family Clinic, how can I help?",
        "Let me look. Can I take the date of birth?",
        "Thanks. Earliest for a new patient is Thursday the thirteenth at nine forty.",
        "Yes, we take Blue Shield PPO. I can hold that slot, reference four four seven one.",
        "Photo identification and the insurance card.",
      ],
      structuredResult: {
        answer_earliest: "Thursday the thirteenth at nine forty in the morning",
        answer_accepts_plan: "yes",
        answer_bring: "photo identification and the insurance card",
        commitment_made: "accepted",
        offered_datetime: "2026-08-13T09:40:00-07:00",
        confirmation_code: "4471",
        callee_declined_automated: "no",
        notes: "",
      },
    },
  ]);
  process.stdout.write(`\n${renderReport(good.report)}\n`);
  const reportPath = join(results, "report.json");
  writeReport(reportPath, good.report);

  heading("2. The clinic will not deal with an automated caller");
  const refused = await run([
    {
      phone: CLINIC,
      botLines: BOT_LINES.slice(0, 2),
      userLines: [
        "Bayview Family Clinic.",
        "Sorry, we do not take appointments from automated systems. She has to call us directly.",
      ],
      structuredResult: {
        answer_earliest: "",
        answer_accepts_plan: "",
        answer_bring: "",
        commitment_made: "declined_by_callee",
        offered_datetime: "",
        confirmation_code: "",
        callee_declined_automated: "yes",
        notes: "asked for the patient to call",
      },
    },
  ]);
  process.stdout.write(`  outcome: ${refused.report.outcome}\n`);
  process.stdout.write(`  next step: ${refused.report.next_step}\n`);
  process.stdout.write("  Nothing was arranged and the report says so. This is a legitimate answer, not a bug.\n");

  heading("3. A time the caller was not allowed to accept");
  const offered = await run([
    {
      phone: CLINIC,
      botLines: BOT_LINES.slice(0, 3),
      userLines: ["Bayview Family Clinic.", "Nothing this week. I could do the twentieth at eleven.", "Fine."],
      structuredResult: {
        answer_earliest: "the twentieth at eleven in the morning",
        answer_accepts_plan: "yes",
        answer_bring: "",
        commitment_made: "other_time_offered",
        offered_datetime: "2026-08-20T11:00:00-07:00",
        confirmation_code: "",
        callee_declined_automated: "no",
        notes: "offered a later date",
      },
    },
  ]);
  process.stdout.write(`  outcome: ${offered.report.outcome}, commitment: ${offered.report.commitment}\n`);
  process.stdout.write(`  next step: ${offered.report.next_step}\n`);

  heading("4. The three privacy gates");
  try {
    parseRequest({
      ...JSON.parse(JSON.stringify(loadRequest(join(appRoot, "examples", "errand.example.json")))),
      errand_id: "leaky",
      on_behalf_of: { name: "Fatima Haddad", reason_for_delegation: "phone only" },
      callee: {
        name: "Bayview Family Clinic",
        phone: CLINIC,
        published_source: "https://example.com/contact",
      },
      goal: { summary: "book a check-up", commitment: "none" },
      disclosure: [{ key: "full_name", label: "the caller's full name", value: "Fatima Haddad" }],
      questions: [{ id: "file", text: "Is her file under 123-45-6789?", answer: "yes_no" }],
    });
    process.stdout.write("  gate 1 did not fire, which is a bug\n");
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stdout.write(`  gate 1, the request file: ${error.message}\n`);
    }
  }

  const leakyScript = parseRequest({
    errand_id: "leaky-script",
    on_behalf_of: { name: "Fatima Haddad", reason_for_delegation: "phone only" },
    callee: { name: "Bayview Family Clinic", phone: CLINIC, published_source: "https://example.com/contact" },
    goal: { summary: "ask them to email fatima.haddad@example.com the result", commitment: "none" },
    disclosure: [{ key: "full_name", label: "the caller's full name", value: "Fatima Haddad" }],
    questions: [{ id: "hours", text: "What are your opening hours on Saturday?", answer: "text" }],
  });
  const fake = await startFakeCalle([{ phone: CLINIC }]);
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  try {
    await runErrand({ request: leakyScript, port, pollIntervalMs: 5 });
    process.stdout.write("  gate 2 did not fire, which is a bug\n");
  } catch (error) {
    if (error instanceof PreflightError) {
      process.stdout.write(`  gate 2, the script: ${error.message}\n`);
      process.stdout.write(`  calls placed: ${fake.created.length}\n`);
    }
  }
  await fake.close();

  const leaked = await run([
    {
      phone: CLINIC,
      botLines: [...BOT_LINES.slice(0, 2), "Her record number is AB-994512, does that help?"],
      userLines: ["Bayview Family Clinic.", "Let me look.", "Found her."],
      structuredResult: {
        answer_earliest: "Thursday the thirteenth at nine forty",
        answer_accepts_plan: "yes",
        answer_bring: "identification",
        commitment_made: "accepted",
        offered_datetime: "2026-08-13T09:40:00-07:00",
        confirmation_code: "4471",
        callee_declined_automated: "no",
        notes: "",
      },
    },
  ]);
  const leak: ErrandReport = leaked.report;
  process.stdout.write(
    `  gate 3, what was actually said: ${leak.leaks.length} finding(s) ${leak.leaks
      .map((finding) => `${finding.kind} (${finding.masked})`)
      .join(", ")}\n`,
  );
  process.stdout.write("  The call still happened and the person is told what was said about them.\n");
  process.stdout.write(`\nReport written to ${reportPath} with mode 0600\n`);
}

await main();

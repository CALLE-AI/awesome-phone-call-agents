/**
 * Runs the whole protocol against a local fake CALL-E, with no credentials and
 * no phone line.
 *
 *   npm run demo
 *
 * Five parts: a run where everybody confirms one time, a run where no time works
 * and the last party is never called, a run where the last party pulls out and
 * everybody who said yes gets a release call, a run that is killed mid-commit and
 * finished by `resume`, then a replay of the clean ledger and of a tampered copy.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkPort } from "../src/calle.js";
import { loadRequest } from "../src/config.js";
import { runCoordination } from "../src/coordinate.js";
import { renderMatrix, renderResult } from "../src/format.js";
import { readEntries, replay } from "../src/ledger.js";
import { resumeCoordination } from "../src/resume.js";
import type { LedgerEntry } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const results = join(appRoot, "results");

const PLUMBER = "+14155550101";
const TENANT = "+14155550100";
const SUPER = "+14155550102";

/**
 * A fixed clock, 10am Pacific, so the demo reads the same at any hour. The
 * example request only allows calls inside each party's calling hours and a demo
 * that refused to dial at midnight would look broken rather than careful.
 */
const CLOCK = Date.parse("2026-08-04T17:00:00Z");

function gather(phone: string, options: number[], spoken: string): FakeScript {
  return {
    phone,
    phase: "gather",
    userLines: ["Hello?", spoken],
    structuredResult: {
      available_options: options,
      none_work: options.length === 0 ? "yes" : "no",
      notes: "",
    },
  };
}

function confirm(phone: string, answer: "confirm" | "decline", spoken: string): FakeScript {
  return {
    phone,
    phase: "confirm",
    userLines: ["Speaking.", spoken],
    structuredResult: { answer, notes: "" },
  };
}

function release(phone: string): FakeScript {
  return {
    phone,
    phase: "release",
    userLines: ["Hello?", "Okay, thanks for letting me know."],
    structuredResult: { acknowledged: "yes", notes: "" },
  };
}

interface DemoCase {
  title: string;
  note: string;
  ledger: string;
  scripts: FakeScript[];
}

const cases: DemoCase[] = [
  {
    title: "1. Three parties, one time that works, confirmed by voice with all three",
    note: "The plumber can do two of the three. That answer shortens every later call.",
    ledger: join(results, "verbally-confirmed.jsonl"),
    scripts: [
      gather(PLUMBER, [1, 2], "Option one and option two work for me."),
      gather(TENANT, [2], "Option two works, I am at work in the morning."),
      gather(SUPER, [2], "Option two is fine."),
      confirm(PLUMBER, "confirm", "Confirm, see you Thursday."),
      confirm(TENANT, "confirm", "Yes that works, confirm."),
      confirm(SUPER, "confirm", "Confirm."),
    ],
  },
  {
    title: "2. No time works, found on the second call",
    note: "The superintendent is never called. Two calls answer a question that usually costs six.",
    ledger: join(results, "no-common-slot.jsonl"),
    scripts: [
      gather(PLUMBER, [1], "Only option one, I am booked after that."),
      gather(TENANT, [], "Option one does not work, I am at work then."),
    ],
  },
  {
    title: "3. The last party pulls out",
    note: "Two people had already said yes. Nothing is booked and both get a release call, most recent first.",
    ledger: join(results, "rolled-back.jsonl"),
    scripts: [
      gather(PLUMBER, [2], "Option two works."),
      gather(TENANT, [2], "Option two works."),
      gather(SUPER, [2], "Option two works."),
      confirm(PLUMBER, "confirm", "Confirm."),
      confirm(TENANT, "confirm", "Confirm, see you then."),
      confirm(SUPER, "decline", "Sorry, something came up, I cannot make that."),
      release(TENANT),
      release(PLUMBER),
    ],
  },
];

/**
 * A run that dies between the yes and the release call, then `resume` finishing
 * what it owed. This is the failure a ledger can prove and only recovery can fix.
 */
async function crashThenResume(request: ReturnType<typeof loadRequest>): Promise<void> {
  const ledger = join(results, "crash-then-resume.jsonl");
  if (existsSync(ledger)) {
    rmSync(ledger);
  }
  const title = "4. A crash between the yes and the release call, then resume";
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
  process.stdout.write("Two parties have said yes when the process is killed. Nobody has been told.\n\n");
  const fake = await startFakeCalle([
    gather(PLUMBER, [2], "Option two works."),
    gather(TENANT, [2], "Option two works."),
    gather(SUPER, [2], "Option two works."),
    confirm(PLUMBER, "confirm", "Confirm."),
    confirm(TENANT, "confirm", "Confirm, see you then."),
    confirm(SUPER, "confirm", "Confirm."),
    release(TENANT),
    release(PLUMBER),
  ]);
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  try {
    await runCoordination({
      request,
      port,
      ledgerPath: ledger,
      pollIntervalMs: 5,
      now: () => CLOCK,
      onProgress: (line) => {
        process.stdout.write(`  ${line}\n`);
        if (line === "  tenant: confirmed.") {
          throw new Error("the process is killed here");
        }
      },
    });
  } catch (error) {
    process.stdout.write(`  ${(error as Error).message}\n\n`);
  }
  const crashed = replay(readEntries(ledger));
  process.stdout.write(`  replay of the crashed ledger: ok=${crashed.ok}\n`);
  for (const issue of crashed.issues) {
    process.stdout.write(`   entry ${issue.entry}: ${issue.problem}\n`);
  }
  process.stdout.write("\n");
  const resumed = await resumeCoordination({
    request,
    port,
    ledgerPath: ledger,
    pollIntervalMs: 5,
    now: () => CLOCK,
    onProgress: (line) => process.stdout.write(`  ${line}\n`),
  });
  await fake.close();
  process.stdout.write(`\n${renderResult(resumed)}\n`);
  const after = replay(readEntries(ledger));
  process.stdout.write(
    `\n  replay after resume: ok=${after.ok}, ${after.entries} entries, outcome ${String(after.outcome)}\n`,
  );
}

async function main(): Promise<void> {
  mkdirSync(results, { recursive: true });
  const request = loadRequest(join(appRoot, "examples", "request.example.json"));

  for (const demo of cases) {
    if (existsSync(demo.ledger)) {
      rmSync(demo.ledger);
    }
    process.stdout.write(`\n${demo.title}\n${"-".repeat(demo.title.length)}\n${demo.note}\n\n`);
    const fake = await startFakeCalle(demo.scripts);
    const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
    const result = await runCoordination({
      request,
      port,
      ledgerPath: demo.ledger,
      pollIntervalMs: 5,
      now: () => CLOCK,
      onProgress: (line) => process.stdout.write(`  ${line}\n`),
    });
    await fake.close();
    process.stdout.write(`\n${renderResult(result)}\n\n`);
    process.stdout.write(`${renderMatrix(readEntries(demo.ledger))}\n`);
  }

  await crashThenResume(request);

  const confirmedLedger = cases[0]!.ledger;
  const entries = readEntries(confirmedLedger);
  const clean = replay(entries);
  process.stdout.write(
    `\n5. Replaying the confirmed run\n------------------------------\n${clean.entries} entries, ${
      clean.ok ? "the recorded answers do imply that confirmation" : "PROBLEMS FOUND"
    }\n`,
  );
  for (const issue of clean.issues) {
    process.stdout.write(`  entry ${issue.entry}: ${issue.problem}\n`);
  }

  const tampered: LedgerEntry[] = entries.map((entry) =>
    entry.kind === "gather" && entry.result.party_id === "tenant"
      ? { ...entry, feasible_after: ["thu-10", "thu-14"] }
      : entry,
  );
  const tamperedPath = join(results, "verbally-confirmed-tampered.jsonl");
  writeFileSync(tamperedPath, `${tampered.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const tamperedCheck = replay(readEntries(tamperedPath));
  process.stdout.write(
    `\n6. Same ledger, one recorded answer widened to keep a time the tenant ruled out\n   replays cleanly: ${tamperedCheck.ok}\n`,
  );
  for (const issue of tamperedCheck.issues) {
    process.stdout.write(`   entry ${issue.entry}: ${issue.problem}\n`);
  }
  process.stdout.write(`\nLedgers written to ${results}\n`);
}

await main();

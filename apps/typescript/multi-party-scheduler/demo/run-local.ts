/**
 * Runs the whole protocol against a local fake CALL-E, with no credentials and
 * no phone line.
 *
 *   npm run demo
 *
 * Three runs: one that books, one that finds no common time and stops early, one
 * where the last party pulls out and everybody who had said yes gets a release
 * call. Then the ledger is replayed and a tampered copy is replayed to show what
 * replay actually catches.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkPort } from "../src/calle.js";
import { loadRequest } from "../src/config.js";
import { runCoordination } from "../src/coordinate.js";
import { renderMatrix, renderResult } from "../src/format.js";
import { readEntries, replay } from "../src/ledger.js";
import type { LedgerEntry } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const results = join(appRoot, "results");

const PLUMBER = "+14155550101";
const TENANT = "+14155550100";
const SUPER = "+14155550102";

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
    title: "1. Three parties, one time that works, booked",
    note: "The plumber can do two of the three. That answer shortens every later call.",
    ledger: join(results, "booked.jsonl"),
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
      onProgress: (line) => process.stdout.write(`  ${line}\n`),
    });
    await fake.close();
    process.stdout.write(`\n${renderResult(result)}\n\n`);
    process.stdout.write(`${renderMatrix(readEntries(demo.ledger))}\n`);
  }

  const bookedLedger = cases[0]!.ledger;
  const entries = readEntries(bookedLedger);
  const clean = replay(entries);
  process.stdout.write(
    `\n4. Replaying the booked run\n---------------------------\n${clean.entries} entries, ${
      clean.ok ? "the recorded answers do imply that booking" : "PROBLEMS FOUND"
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
  const tamperedPath = join(results, "booked-tampered.jsonl");
  writeFileSync(tamperedPath, `${tampered.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const tamperedCheck = replay(readEntries(tamperedPath));
  process.stdout.write(
    `\n5. Same ledger, one recorded answer widened to keep a time the tenant ruled out\n   replays cleanly: ${tamperedCheck.ok}\n`,
  );
  for (const issue of tamperedCheck.issues) {
    process.stdout.write(`   entry ${issue.entry}: ${issue.problem}\n`);
  }
  process.stdout.write(`\nLedgers written to ${results}\n`);
}

await main();

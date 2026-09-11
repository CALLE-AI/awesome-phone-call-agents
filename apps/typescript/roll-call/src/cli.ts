import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { DryRunPlacer, LivePlacer, type CallPlacer, type PlaceCallRequest } from "./calle.js";
import { loadRollCallInput } from "./intake.js";
import { Ledger } from "./ledger.js";
import { mayCallGuardian } from "./policy.js";
import { maskPhone, maskPhonesInText } from "./privacy.js";
import { renderReport } from "./report.js";
import { buildTask } from "./script.js";
import { runRollCall } from "./run.js";

const USAGE = `Roll Call — first-hour absence verification for schools

  rollcall preview --absences <file.json>
      Print, for every guardian, whether they would be dialled and the exact
      words CALL-E would be given. Places no call. Needs no API key.

  rollcall run --absences <file.json> [--ledger <file.jsonl>] [--out <report.json>]
      Dry run (default): walks the cascade and writes a report; no call.

  rollcall run --live --absences <file.json> --ledger <file.jsonl> [--out <report.json>] [--yes]
      Places real calls through CALL-E. Requires CALLE_API_KEY, a ledger file,
      and a typed confirmation per call unless --yes is given.

Environment: CALLE_API_KEY, CALLE_BASE_URL (optional), ROLLCALL_NOW (ISO, for tests)
`;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function now(): Date {
  const forced = process.env.ROLLCALL_NOW;
  return forced ? new Date(forced) : new Date();
}

async function preview(argv: string[]): Promise<number> {
  const path = arg(argv, "--absences");
  if (!path) throw new Error("--absences <file.json> is required");
  const input = loadRollCallInput(path);
  const at = now();
  console.log(`Preview for ${input.school.schoolName} at ${at.toISOString()} — no call will be placed\n`);
  for (const absence of input.absences) {
    console.log(`${absence.firstName} (${absence.classLabel}, id ${absence.studentId}, ${absence.date})`);
    absence.guardians.forEach((g, i) => {
      const verdict = mayCallGuardian(g, i, absence, input.school, at);
      const masked = maskPhone(g.phone);
      if (!verdict.allowed) {
        console.log(`  guardian ${i + 1} ${masked}: would NOT be dialled — ${verdict.reason}`);
        return;
      }
      console.log(`  guardian ${i + 1} ${masked} (${g.locale}/${g.region}): would be dialled with this task:`);
      for (const line of buildTask(absence, g, input.school).split("\n")) {
        console.log(`      ${maskPhonesInText(line)}`);
      }
    });
    console.log("");
  }
  return 0;
}

async function run(argv: string[]): Promise<number> {
  const path = arg(argv, "--absences");
  if (!path) throw new Error("--absences <file.json> is required");
  const live = argv.includes("--live");
  const ledgerPath = arg(argv, "--ledger") ?? null;
  const outPath = arg(argv, "--out");
  const input = loadRollCallInput(path);

  let placer: CallPlacer;
  let approve: ((r: PlaceCallRequest) => Promise<boolean>) | undefined;
  if (live) {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) throw new Error("--live requires CALLE_API_KEY in the environment");
    if (!ledgerPath) throw new Error("--live requires --ledger <file.jsonl> so a crash cannot dial anybody twice");
    placer = new LivePlacer({ apiKey, baseUrl: process.env.CALLE_BASE_URL });
    if (!argv.includes("--yes")) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      approve = async (r) => {
        console.log(`\nAbout to place a REAL call to ${maskPhone(r.phone)} (${r.locale}/${r.region}), key ${r.idempotencyKey}`);
        const answer = await rl.question("Type the last two digits of the number to confirm, anything else to skip: ");
        return answer.trim() === r.phone.slice(-2);
      };
    }
  } else {
    placer = new DryRunPlacer();
  }

  const report = await runRollCall(input, {
    placer,
    ledger: new Ledger(ledgerPath),
    now,
    approve,
    log: (line) => console.error(maskPhonesInText(line)),
  });
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(renderReport(report));
  return report.totals.safeguarding_alert > 0 ? 2 : 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "preview":
      return preview(rest);
    case "run":
      return run(rest);
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });

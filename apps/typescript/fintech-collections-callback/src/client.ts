// Entry point. Iterates overdue accounts, runs the pre-dial gate, and (in live
// mode) places one CALL-E call per allowed account under a spend cap. Dry-run is
// the default and never touches the network.
//
//   npm run dry-run              # default: no calls placed
//   npm run live                 # requires CALLE_API_KEY
//   npm run dev -- --max-calls=3 # override the spend cap

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import type { CallOutcome, OverdueAccount } from "./types.js";
import { DEFAULT_GATE, checkAccount, type GateConfig } from "./gate.js";
import { SAMPLE_ACCOUNTS } from "./fixtures.js";
import { buildSmokeAccount } from "./smoke.js";

// Load a local .env (from the current directory) if present, so CALLE_API_KEY
// and friends can live there for --live runs instead of being exported by hand.
// No-op when the file is absent or the runtime predates process.loadEnvFile
// (Node < 20.12) — variables set in the shell still work either way.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env in the current directory; dry-run needs none, so carry on.
  }
}

const COST_PER_CALL_USD = 0.05;
const DEFAULT_MAX_CALLS = 10;

interface CliArgs {
  live: boolean;
  maxCalls: number;
  smoke: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const live = argv.includes("--live");
  const smoke = argv.includes("--smoke");
  const capArg = argv.find((a) => a.startsWith("--max-calls="));
  const parsed = capArg ? Number(capArg.slice("--max-calls=".length)) : DEFAULT_MAX_CALLS;
  const maxCalls = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_CALLS;
  return { live, maxCalls, smoke };
}

interface RunOptions {
  live: boolean;
  maxCalls: number;
  accounts: OverdueAccount[];
  gate: GateConfig;
}

async function run(opts: RunOptions): Promise<CallOutcome[]> {
  const outcomes: CallOutcome[] = [];
  let placed = 0;
  let cancelled = false;

  const onSigint = () => {
    cancelled = true;
    console.error("\n[cancel] no new calls will start; finishing report…");
  };
  process.on("SIGINT", onSigint);

  // Lazy-load the SDK only for live runs, so dry-run needs no key and no install-time network.
  let calle: typeof import("./calle.js") | undefined;
  let client: import("./calle.js").CalleClientLike | undefined;
  if (opts.live) {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) {
      throw new Error("CALLE_API_KEY is required for --live runs. Set it, or drop --live to dry-run.");
    }
    calle = await import("./calle.js");
    client = calle.createCalleClient(apiKey, process.env.CALLE_BASE_URL);
  }

  const mode: CallOutcome["mode"] = opts.live ? "live" : "dry-run";

  for (const account of opts.accounts) {
    if (cancelled) break;
    const at = new Date().toISOString();

    const decision = checkAccount(account, opts.gate);
    if (!decision.allowed) {
      outcomes.push({ accountId: account.accountId, phone: account.phone, mode, placed: false, blockedReason: decision.reason, at });
      console.log(`[skip] ${account.accountId} ${account.phone} — blocked: ${decision.reason}`);
      continue;
    }

    if (placed >= opts.maxCalls) {
      outcomes.push({ accountId: account.accountId, phone: account.phone, mode, placed: false, blockedReason: "spend-cap-reached", at });
      console.log(`[skip] ${account.accountId} — spend cap reached (${opts.maxCalls} calls)`);
      continue;
    }

    if (!opts.live) {
      // Count against the cap so a dry-run mirrors live budgeting exactly.
      placed++;
      outcomes.push({ accountId: account.accountId, phone: account.phone, mode, placed: false, at });
      console.log(`[dry-run] would call ${account.phone} for ${account.customerName} (${account.daysPastDue}d past due)`);
      continue;
    }

    try {
      const res = await calle!.placeCall(client!, account);
      placed++;
      outcomes.push({
        accountId: account.accountId,
        phone: account.phone,
        mode,
        placed: true,
        callId: res.callId,
        status: res.status,
        taskCompleted: res.taskCompleted,
        confidence: res.confidence,
        structured: res.structured,
        at,
      });
      console.log(`[live] ${account.accountId} ${account.phone} — ${res.status} — ${res.structured?.outcome ?? "no-result"}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ accountId: account.accountId, phone: account.phone, mode, placed: false, error: message, at });
      console.error(`[error] ${account.accountId} ${account.phone} — ${message}`);
    }
  }

  process.off("SIGINT", onSigint);
  return outcomes;
}

async function writeReport(opts: CliArgs, outcomes: CallOutcome[]): Promise<string> {
  const placedCount = outcomes.filter((o) => o.placed).length;
  const dir = join(process.cwd(), "runs");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const report = {
    mode: opts.live ? "live" : "dry-run",
    smoke: opts.smoke,
    maxCalls: opts.maxCalls,
    costPerCallUsd: COST_PER_CALL_USD,
    placedCount,
    estCostUsd: Number((placedCount * COST_PER_CALL_USD).toFixed(2)),
    outcomes,
  };
  await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Smoke mode targets exactly one recipient built from SMOKE_* env vars, so a
  // real --live call can hit a number you control instead of the fixtures.
  const accounts = args.smoke ? [buildSmokeAccount()] : SAMPLE_ACCOUNTS;
  const maxCalls = args.smoke ? 1 : args.maxCalls;
  const effectiveArgs: CliArgs = { ...args, maxCalls };

  const banner = args.smoke ? " SMOKE(1 recipient from SMOKE_* env)" : "";
  console.log(`CALL-E fintech collections callback — mode=${args.live ? "LIVE" : "DRY-RUN"}${banner} cap=${maxCalls} calls`);
  if (!args.live) {
    console.log("No calls will be placed. Re-run with --live and CALLE_API_KEY set to dial.\n");
  } else if (args.smoke) {
    console.log("SMOKE live run: places ONE real call to SMOKE_PHONE if it passes the gate.\n");
  }

  const outcomes = await run({ live: args.live, maxCalls, accounts, gate: DEFAULT_GATE });

  const placedCount = outcomes.filter((o) => o.placed).length;
  const skipped = outcomes.length - placedCount;
  const estCost = (placedCount * COST_PER_CALL_USD).toFixed(2);
  console.log(`\nSummary: ${placedCount} placed, ${skipped} skipped. Est. cost: $${estCost}`);

  const file = await writeReport(effectiveArgs, outcomes);
  console.log(`Results written to ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

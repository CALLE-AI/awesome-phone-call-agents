#!/usr/bin/env node
/**
 * Preview or place one wellness check-in call.
 *
 *   node --import tsx src/cli.ts --request examples/recipient.example.json
 *   node --import tsx src/cli.ts --request my-request.json --execute --confirm-recipient-opt-in
 */
import { writeFileSync } from "node:fs";
import { ConfigError, loadRequest } from "./config.js";
import { createSdkPort, DEFAULT_BASE_URL } from "./calle.js";
import { previewCheckin, runCheckin } from "./checkin.js";

interface Args {
  request: string;
  execute: boolean;
  confirmOptIn: boolean;
  output: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { request: "", execute: false, confirmOptIn: false, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--request") args.request = argv[++i] ?? "";
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--confirm-recipient-opt-in") args.confirmOptIn = true;
    else if (arg === "--output") args.output = argv[++i] ?? null;
  }
  if (!args.request) {
    throw new ConfigError("--request <path> is required.");
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const request = loadRequest(args.request);

  if (!args.execute) {
    const plan = previewCheckin(request);
    process.stdout.write("Preview only — no call was placed.\n\n");
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write("\nAdd --execute --confirm-recipient-opt-in to place a real call.\n");
    return;
  }

  if (!args.confirmOptIn) {
    throw new ConfigError(
      "--execute requires --confirm-recipient-opt-in — this app will not place a live call otherwise."
    );
  }

  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) {
    throw new ConfigError("Set CALLE_API_KEY to place a live call.");
  }

  const port = await createSdkPort({ apiKey, baseUrl: process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL });
  const report = await runCheckin({
    request,
    port,
    onProgress: (line) => process.stderr.write(`${line}\n`),
  });

  const json = JSON.stringify(report, null, 2);
  process.stdout.write(`${json}\n`);
  if (args.output) {
    writeFileSync(args.output, json, { mode: 0o600 });
    process.stderr.write(`\nReport written to ${args.output} with mode 0600\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

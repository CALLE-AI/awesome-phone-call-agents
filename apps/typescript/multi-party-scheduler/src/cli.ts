#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Exit codes:
 *   0  booked
 *   10 no time works for everyone, which is a real answer
 *   20 not booked for another reason (a party did not confirm, was not reached,
 *      the window closed, the call budget ran out or CALL-E returned an error)
 *   30 usage or request file error
 *   40 replay found a problem in a ledger
 *
 * Progress goes to stderr, results to stdout.
 */

import { ConfigError, loadRequest } from "./config.js";
import { createSdkPort, DEFAULT_BASE_URL } from "./calle.js";
import { runCoordination } from "./coordinate.js";
import { renderMatrix, renderPlan, renderResult } from "./format.js";
import { readEntries, replay } from "./ledger.js";

const EXIT_BOOKED = 0;
const EXIT_NO_COMMON_SLOT = 10;
const EXIT_NOT_BOOKED = 20;
const EXIT_USAGE = 30;
const EXIT_REPLAY_FAILED = 40;

const USAGE = `Multi-party scheduler

  plan --request <file> [--json]
      Print the options, the call order, the call budget and every call script.
      Places no call and needs no credentials.

  run --request <file> --live [--ledger <file>] [--json] [--base-url <url>]
      Gather availability, confirm one slot with everybody, release everyone who
      confirmed if the commit fails. Needs CALLE_API_KEY.

  replay --ledger <file> [--json]
      Recompute the feasible set, the chosen slot and the outcome from the
      recorded answers and print the availability grid.

Exit codes: 0 booked, 10 no common slot, 20 not booked, 30 usage error, 40 replay failed.`;

interface Parsed {
  command: string;
  values: Record<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): Parsed {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const command = argv[0] ?? "";
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      throw new ConfigError(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "live" || name === "json" || name === "help") {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ConfigError(`Option --${name} needs a value.`);
    }
    values[name] = value;
    index += 1;
  }
  return { command, values, flags };
}

function requireValue(parsed: Parsed, name: string): string {
  const value = parsed.values[name];
  if (value === undefined) {
    throw new ConfigError(`Option --${name} is required.`);
  }
  return value;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "" || parsed.command === "help" || parsed.flags.has("help")) {
    process.stdout.write(`${USAGE}\n`);
    return parsed.command === "" ? EXIT_USAGE : EXIT_BOOKED;
  }

  if (parsed.command === "plan") {
    const request = loadRequest(requireValue(parsed, "request"));
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
      return EXIT_BOOKED;
    }
    process.stdout.write(`${renderPlan(request)}\n`);
    return EXIT_BOOKED;
  }

  if (parsed.command === "replay") {
    const path = requireValue(parsed, "ledger");
    const entries = readEntries(path);
    const verification = replay(entries);
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderMatrix(entries)}\n\n`);
      process.stdout.write(
        verification.ok
          ? `${verification.entries} entries replay cleanly, outcome ${String(verification.outcome)}.\n`
          : `${verification.entries} entries checked, problems found:\n`,
      );
      for (const issue of verification.issues) {
        process.stdout.write(`  entry ${issue.entry}: ${issue.problem}\n`);
      }
    }
    return verification.ok ? EXIT_BOOKED : EXIT_REPLAY_FAILED;
  }

  if (parsed.command === "run") {
    const request = loadRequest(requireValue(parsed, "request"));
    if (!parsed.flags.has("live")) {
      throw new ConfigError(
        "run places real phone calls. Look at plan first, then add --live when the options and the order are right.",
      );
    }
    const apiKey = process.env.CALLE_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ConfigError("CALLE_API_KEY is not set. The scheduler never reads keys from the request file.");
    }
    const baseUrl = parsed.values["base-url"] ?? process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL;
    const port = await createSdkPort({ apiKey, baseUrl });
    const result = await runCoordination({
      request,
      port,
      ledgerPath: parsed.values["ledger"] ?? null,
      onProgress: (line) => process.stderr.write(`${line}\n`),
    });
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderResult(result)}\n`);
    }
    if (result.outcome === "booked") {
      return EXIT_BOOKED;
    }
    return result.outcome === "no_common_slot" ? EXIT_NO_COMMON_SLOT : EXIT_NOT_BOOKED;
  }

  throw new ConfigError(`Unknown command: ${parsed.command}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = EXIT_USAGE;
  });

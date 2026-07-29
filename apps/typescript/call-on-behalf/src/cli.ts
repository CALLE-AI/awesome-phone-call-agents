#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Exit codes:
 *   0  the errand did what it was asked
 *   10 partly done or something was offered that needs the person to decide
 *   20 nothing was arranged: they will not deal with an automated caller, a
 *      machine answered, nobody answered or the call failed
 *   30 usage error or the privacy check refused the script
 *
 * Progress goes to stderr, the report to stdout.
 */

import { createSdkPort, DEFAULT_BASE_URL } from "./calle.js";
import { ConfigError, loadRequest } from "./config.js";
import { PreflightError, runErrand } from "./errand.js";
import { readReport, renderPreview, renderReport, writeReport } from "./report.js";

const EXIT_DONE = 0;
const EXIT_PARTIAL = 10;
const EXIT_NOT_DONE = 20;
const EXIT_USAGE = 30;

const USAGE = `Call on behalf

  preview --errand <file>
      Print the exact call script, the details it may give and the privacy check.
      Places no call and needs no credentials.

  call --errand <file> --live [--report <file>] [--json] [--base-url <url>]
      Place one call. Needs CALLE_API_KEY.

  show --report <file>
      Re-render a saved report as text.

Exit codes: 0 done, 10 partly done, 20 nothing arranged, 30 usage or privacy refusal.`;

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
    return parsed.command === "" ? EXIT_USAGE : EXIT_DONE;
  }

  if (parsed.command === "preview") {
    const request = loadRequest(requireValue(parsed, "errand"));
    process.stdout.write(`${renderPreview(request)}\n`);
    return EXIT_DONE;
  }

  if (parsed.command === "show") {
    const report = readReport(requireValue(parsed, "report"));
    process.stdout.write(`${renderReport(report)}\n`);
    return EXIT_DONE;
  }

  if (parsed.command === "call") {
    const request = loadRequest(requireValue(parsed, "errand"));
    if (!parsed.flags.has("live")) {
      throw new ConfigError(
        "call places a real phone call. Read the preview first, then add --live when the script is right.",
      );
    }
    const apiKey = process.env.CALLE_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ConfigError("CALLE_API_KEY is not set. This app never reads a key from the errand file.");
    }
    const baseUrl = parsed.values["base-url"] ?? process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL;
    const port = await createSdkPort({ apiKey, baseUrl });
    const report = await runErrand({
      request,
      port,
      onProgress: (line) => process.stderr.write(`${line}\n`),
    });
    const reportPath = parsed.values["report"];
    if (reportPath !== undefined) {
      writeReport(reportPath, report);
      process.stderr.write(`Report written to ${reportPath} with mode 0600.\n`);
    }
    process.stdout.write(
      parsed.flags.has("json") ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`,
    );
    if (report.outcome === "goal_met") {
      return EXIT_DONE;
    }
    return report.outcome === "partially_met" ? EXIT_PARTIAL : EXIT_NOT_DONE;
  }

  throw new ConfigError(`Unknown command: ${parsed.command}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof PreflightError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = EXIT_USAGE;
  });

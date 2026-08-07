#!/usr/bin/env node
import { QuoteRequestError, loadQuoteRequest } from "./config.js";
import { renderReport } from "./format.js";
import { previewReceipt, previewText } from "./script.js";
import { createSdkPort, runQuotes, writeReport } from "./runner.js";

const USAGE = `QuoteChaser

  preview --request <file>
      Print the approved buying brief and consent receipt. Places no calls.

  call --request <file> --live --receipt <hash> --report <file> [--json]
      Call every vendor in the request with CALL-E and write a structured report.
      Needs CALLE_API_KEY. The receipt must match the preview for the same file.

  help
      Show this message.`;

interface Parsed {
  command: string;
  values: Record<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): Parsed {
  const command = argv[0] ?? "";
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      throw new QuoteRequestError(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "live" || name === "json") {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new QuoteRequestError(`Option --${name} needs a value.`);
    }
    values[name] = value;
    index += 1;
  }
  return { command, values, flags };
}

function required(parsed: Parsed, name: string): string {
  const value = parsed.values[name];
  if (value === undefined) {
    throw new QuoteRequestError(`Option --${name} is required.`);
  }
  return value;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "" || parsed.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return parsed.command === "" ? 30 : 0;
  }
  if (parsed.command === "preview") {
    const request = loadQuoteRequest(required(parsed, "request"));
    process.stdout.write(`${previewText(request)}\n`);
    return 0;
  }
  if (parsed.command === "call") {
    if (!parsed.flags.has("live")) {
      throw new QuoteRequestError("Refusing to place calls without --live.");
    }
    const request = loadQuoteRequest(required(parsed, "request"));
    const receipt = required(parsed, "receipt");
    if (receipt !== previewReceipt(request)) {
      throw new QuoteRequestError("Receipt does not match this request file. Run preview again and review it.");
    }
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) {
      throw new QuoteRequestError("CALLE_API_KEY is required for live calls.");
    }
    const report = await runQuotes(request, createSdkPort(apiKey));
    writeReport(required(parsed, "report"), report);
    process.stdout.write(parsed.flags.has("json") ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report, request)}\n`);
    return 0;
  }
  throw new QuoteRequestError(`Unknown command: ${parsed.command}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 30;
  });

#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Exit codes are the contract a script or an agent gates on:
 *   0  confirmed_genuine, the institution says the contact was theirs
 *   10 no_such_contact, nobody there has a record of it
 *   20 refused_to_confirm, they will not discuss another person's account
 *   30 unreachable, the call reached nobody
 *   40 outcome_unknown, this app could not read an answer
 *   50 usage error, a refused claim file or a receipt that does not match
 *   60 record verification failed
 *
 * 0 means the contact was confirmed. It does not mean the message was safe, so the
 * result says what to do either way.
 *
 * Progress goes to stderr and the result goes to stdout, so `--json` stays
 * parseable while a log still shows what happened.
 */

import { assertTrustedBaseUrl, createSdkPort, DEFAULT_BASE_URL, parseAllowedHosts } from "./calle.js";
import { runCheck } from "./check.js";
import { ClaimError, loadClaim } from "./config.js";
import { renderPreview, renderResult } from "./format.js";
import { verifyRecord } from "./record.js";
import { previewReceipt } from "./script.js";
import type { Outcome } from "./types.js";

const EXIT_BY_OUTCOME: Record<Outcome, number> = {
  confirmed_genuine: 0,
  no_such_contact: 10,
  refused_to_confirm: 20,
  unreachable: 30,
  outcome_unknown: 40,
};
const EXIT_OK = 0;
const EXIT_USAGE = 50;
const EXIT_RECORD_FAILED = 60;

const USAGE = `Verify a contact claim

  preview --claim <file>
      Print the one question, the exact script, the number that will be dialled and
      a receipt for this preview. Places no call and needs no credentials.

  check --claim <file> --live --receipt <hash> --record <file> [--json]
        [--base-url <url>] [--allow-host <host>]
      Place one call to the trusted number from the claim file, ask the one question
      then append one record. Needs CALLE_API_KEY. The receipt has to be the one the
      preview printed for this claim file. A base URL outside
      https://api.heycall-e.com and loopback needs its host named in --allow-host or
      CALLE_ALLOWED_HOSTS. The key goes nowhere else.

  verify --record <file> [--json]
      Re-link the record chain, re-read the words and recompute every outcome.

Exit codes: 0 the contact was confirmed, 10 no such contact, 20 they would not
confirm, 30 unreachable, 40 outcome unknown, 50 usage or a refusal, 60 record
verification failed.`;

interface Parsed {
  command: string;
  values: Record<string, string>;
  /** Options that may be given more than once. */
  lists: Record<string, string[]>;
  flags: Set<string>;
}

/** An operator may have to name more than one host, so this one accumulates. */
const REPEATABLE = new Set(["allow-host"]);
const FLAGS = new Set(["live", "json", "help"]);

function parseArgs(argv: string[]): Parsed {
  const values: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const flags = new Set<string>();
  const command = argv[0] ?? "";
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      throw new ClaimError(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ClaimError(`Option --${name} needs a value.`);
    }
    if (REPEATABLE.has(name)) {
      (lists[name] ??= []).push(value);
    } else {
      values[name] = value;
    }
    index += 1;
  }
  return { command, values, lists, flags };
}

function requireValue(parsed: Parsed, name: string): string {
  const value = parsed.values[name];
  if (value === undefined) {
    throw new ClaimError(`Option --${name} is required.`);
  }
  return value;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "" || parsed.command === "help" || parsed.flags.has("help")) {
    process.stdout.write(`${USAGE}\n`);
    return parsed.command === "" ? EXIT_USAGE : EXIT_OK;
  }

  if (parsed.command === "preview") {
    const claim = loadClaim(requireValue(parsed, "claim"));
    process.stdout.write(`${renderPreview(claim)}\n`);
    return EXIT_OK;
  }

  if (parsed.command === "verify") {
    const result = verifyRecord(requireValue(parsed, "record"));
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      process.stdout.write(`${result.records} record(s) verified. Chain, words and outcomes hold.\n`);
    } else {
      process.stdout.write(`${result.records} record(s) checked. Problems found:\n`);
      for (const issue of result.issues) {
        process.stdout.write(`  record ${issue.seq}: ${issue.problem}\n`);
      }
    }
    return result.ok ? EXIT_OK : EXIT_RECORD_FAILED;
  }

  if (parsed.command === "check") {
    const claim = loadClaim(requireValue(parsed, "claim"));
    if (!parsed.flags.has("live")) {
      throw new ClaimError(
        "check places a real phone call. Read the preview first, then add --live when the script is right.",
      );
    }
    // Consent is a receipt for a preview somebody read, not a flag. The hash covers
    // every field the preview printed, so an edited claim file is a preview nobody
    // has seen. The refusal does not print the right receipt: that would make the
    // consent step a formality.
    const receipt = parsed.values["receipt"];
    if (receipt === undefined) {
      throw new ClaimError(
        "check --live needs --receipt <hash>. Run preview --claim <file>, read the one question this app will ask, then pass the receipt it prints.",
      );
    }
    if (receipt !== previewReceipt(claim)) {
      throw new ClaimError(
        `Receipt ${receipt} is not the receipt for this claim file, so no call was placed. The file has changed since that preview. Run preview --claim <file> again, read it, then pass the receipt it prints.`,
      );
    }
    const recordPath = parsed.values["record"];
    if (recordPath === undefined) {
      throw new ClaimError(
        "Option --record is required for a live run. Every run appends one record, including the runs that answered nothing, because those are the ones somebody asks about later.",
      );
    }
    // Before the credential is read, because a warning after the fact is no use:
    // by then the key has already left. https alone would only say the transport
    // was encrypted.
    const allowedHosts = parseAllowedHosts([
      ...(parsed.lists["allow-host"] ?? []),
      process.env.CALLE_ALLOWED_HOSTS,
    ]);
    const configured = parsed.values["base-url"] ?? process.env.CALLE_BASE_URL;
    const baseUrl = configured === undefined || configured.length === 0 ? DEFAULT_BASE_URL : configured;
    assertTrustedBaseUrl(baseUrl, allowedHosts);

    const apiKey = process.env.CALLE_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ClaimError("CALLE_API_KEY is not set. This app never reads a key from the claim file.");
    }
    const port = await createSdkPort({ apiKey, baseUrl, allowedHosts });
    const result = await runCheck({
      claim,
      port,
      recordPath,
      onProgress: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(
      parsed.flags.has("json") ? `${JSON.stringify(result, null, 2)}\n` : `${renderResult(result)}\n`,
    );
    return EXIT_BY_OUTCOME[result.outcome];
  }

  throw new ClaimError(`Unknown command: ${parsed.command}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ClaimError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = EXIT_USAGE;
  });

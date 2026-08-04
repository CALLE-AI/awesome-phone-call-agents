#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Exit codes:
 *   0  every party confirmed the time by voice
 *   10 no time works for everyone, which is a real answer
 *   20 not confirmed for another reason (a party did not confirm, was not
 *      reached, the window closed, the call budget ran out, the run was canceled
 *      or CALL-E returned an error)
 *   30 usage or request file error, a ledger that already records this
 *      coordination included
 *   40 replay found a problem in a ledger
 *
 * Progress goes to stderr, results to stdout.
 */

import { ConfigError, loadRequest } from "./config.js";
import { createSdkPort, DEFAULT_BASE_URL } from "./calle.js";
import { runCoordination } from "./coordinate.js";
import { redactRequest, renderMatrix, renderPlan, renderResult } from "./format.js";
import { LedgerError, readLedger, replay } from "./ledger.js";
import { ResumeError, resumeCoordination } from "./resume.js";

const EXIT_CONFIRMED = 0;
const EXIT_NO_COMMON_SLOT = 10;
const EXIT_NOT_CONFIRMED = 20;
const EXIT_USAGE = 30;
const EXIT_REPLAY_FAILED = 40;

const USAGE = `Multi-party scheduler

  plan --request <file> [--json]
      Print the options, the call order, the calling hours, the call budget and
      every call script. Places no call and needs no credentials.

  run --request <file> --live --ledger <file> [--json] [--base-url <url>] [--allow-host <host>]
      Gather availability, confirm one slot with everybody, release everyone who
      confirmed if the commit fails. Needs CALLE_API_KEY. The ledger is required:
      it is the durable state resume reads if this run does not finish. Ctrl-C
      stops the run and still places the release calls that are owed. A ledger
      that already records this coordination is never run again: a finished one is
      printed as it stands with no call placed, anything left open belongs to
      resume.

  resume --request <file> --ledger <file> --live [--json] [--base-url <url>] [--allow-host <host>] [--retry-release]
      Finish an interrupted run: settle every call the ledger cannot account for
      and place the release calls that are still owed. Needs CALLE_API_KEY. Every
      call it settles goes out under the key the ledger recorded for it.
      --retry-release authorizes one exception, calling somebody again whose
      release call reached nobody, which is a new key and so a phone ringing
      again. Without it that debt is reported and nothing is dialled.

  replay --ledger <file> [--json]
      Recompute the feasible set, the chosen slot and the outcome from the
      recorded answers and print the availability grid.

An appointment this app arranges is a verbal confirmation from every party. It
writes to no calendar and creates no booking anywhere.

CALLE_API_KEY is read from the environment only. --base-url and CALLE_BASE_URL
pick the host and only api.heycall-e.com, localhost, 127.0.0.1 and ::1 are
trusted with the key. Name another with --allow-host <host>, which can be
repeated or with CALLE_ALLOWED_HOSTS. Hostnames are matched exactly.

Exit codes: 0 confirmed by every party, 10 no common slot, 20 not confirmed, 30 usage or ledger error, 40 replay failed.`;

interface Parsed {
  command: string;
  values: Record<string, string>;
  /** Options that may be given more than once, in the order they were given. */
  repeated: Record<string, string[]>;
  flags: Set<string>;
}

/** Options where a second use adds to the first rather than replacing it. */
const REPEATABLE = new Set(["allow-host"]);

function parseArgs(argv: string[]): Parsed {
  const values: Record<string, string> = {};
  const repeated: Record<string, string[]> = {};
  const flags = new Set<string>();
  const command = argv[0] ?? "";
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      throw new ConfigError(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "live" || name === "json" || name === "help" || name === "retry-release") {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ConfigError(`Option --${name} needs a value.`);
    }
    if (REPEATABLE.has(name)) {
      (repeated[name] ??= []).push(value);
    } else {
      values[name] = value;
    }
    index += 1;
  }
  return { command, values, repeated, flags };
}

function requireValue(parsed: Parsed, name: string): string {
  const value = parsed.values[name];
  if (value === undefined) {
    throw new ConfigError(`Option --${name} is required.`);
  }
  return value;
}

/**
 * A live run needs durable state before the first call.
 *
 * With no ledger every recovery entry is discarded, so a crash or a second
 * interrupt after somebody has said yes on a call leaves no way to reconcile
 * that call and nobody to tell that the time is off. The in memory path is for
 * unit tests and for `plan`, not for a run that dials people.
 */
function requireLedger(parsed: Parsed): string {
  const value = parsed.values["ledger"];
  if (value === undefined || value.length === 0) {
    throw new ConfigError(
      `${parsed.command} dials people, so it needs --ledger <file>. That file is what resume reads to settle a call this run could not finish and to place the release calls it owes. Nothing was dialled.`,
    );
  }
  return value;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "" || parsed.command === "help" || parsed.flags.has("help")) {
    process.stdout.write(`${USAGE}\n`);
    return parsed.command === "" ? EXIT_USAGE : EXIT_CONFIRMED;
  }

  if (parsed.command === "plan") {
    const request = loadRequest(requireValue(parsed, "request"));
    if (parsed.flags.has("json")) {
      // Masked, like every other output. A plan is meant to be shared.
      process.stdout.write(`${JSON.stringify(redactRequest(request), null, 2)}\n`);
      return EXIT_CONFIRMED;
    }
    process.stdout.write(`${renderPlan(request)}\n`);
    return EXIT_CONFIRMED;
  }

  if (parsed.command === "replay") {
    const path = requireValue(parsed, "ledger");
    const { entries, truncatedTail } = readLedger(path);
    const verification = replay(entries);
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify({ ...verification, truncated_tail: truncatedTail }, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderMatrix(entries)}\n\n`);
      if (truncatedTail) {
        process.stdout.write(
          "The last line is half an entry, which is what a crash during an append leaves. It is not counted below.\n",
        );
      }
      process.stdout.write(
        verification.ok
          ? `${verification.entries} entries replay cleanly, outcome ${String(verification.outcome)}.\n`
          : `${verification.entries} entries checked, problems found:\n`,
      );
      for (const issue of verification.issues) {
        process.stdout.write(`  entry ${issue.entry}: ${issue.problem}\n`);
      }
    }
    return verification.ok ? EXIT_CONFIRMED : EXIT_REPLAY_FAILED;
  }

  if (parsed.command === "run" || parsed.command === "resume") {
    const request = loadRequest(requireValue(parsed, "request"));
    if (!parsed.flags.has("live")) {
      throw new ConfigError(
        `${parsed.command} places real phone calls. Look at plan first, then add --live when the options and the order are right.`,
      );
    }
    if (parsed.command === "run" && parsed.flags.has("retry-release")) {
      // Nothing here would honour it, and a flag that looks like it authorizes a
      // call and does not is worse than no flag. A run places one release call per
      // party, so it has no earlier attempt to retry.
      throw new ConfigError(
        "--retry-release is a resume option. run places one release call per party, so there is no earlier attempt for it to retry.",
      );
    }
    const ledgerPath = requireLedger(parsed);
    const apiKey = process.env.CALLE_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ConfigError("CALLE_API_KEY is not set. The scheduler never reads keys from the request file.");
    }
    const baseUrl = parsed.values["base-url"] ?? process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL;
    const port = await createSdkPort({
      apiKey,
      baseUrl,
      allowHosts: parsed.repeated["allow-host"] ?? [],
    });
    const progress = (line: string): void => {
      process.stderr.write(`${line}\n`);
    };
    let result;
    if (parsed.command === "resume") {
      result = await resumeCoordination({
        request,
        port,
        ledgerPath,
        onProgress: progress,
        retryRelease: parsed.flags.has("retry-release"),
      });
    } else {
      // Ctrl-C cancels the coordination. It does not cancel the release calls
      // owed to anybody who already said yes, so the first signal asks the run to
      // stop and a second one gives up on that too.
      const canceling = new AbortController();
      const onSignal = (): void => {
        if (canceling.signal.aborted) {
          process.stderr.write("Second interrupt, stopping without the release calls.\n");
          process.exit(EXIT_NOT_CONFIRMED);
        }
        process.stderr.write("Canceling. No new call will be placed and anybody who said yes is being told.\n");
        canceling.abort();
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      try {
        result = await runCoordination({
          request,
          port,
          ledgerPath,
          signal: canceling.signal,
          onProgress: progress,
        });
      } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    }
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderResult(result)}\n`);
    }
    if (result.outcome === "verbally_confirmed") {
      return EXIT_CONFIRMED;
    }
    return result.outcome === "no_common_slot" ? EXIT_NO_COMMON_SLOT : EXIT_NOT_CONFIRMED;
  }

  throw new ConfigError(`Unknown command: ${parsed.command}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ConfigError || error instanceof LedgerError || error instanceof ResumeError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = EXIT_USAGE;
  });

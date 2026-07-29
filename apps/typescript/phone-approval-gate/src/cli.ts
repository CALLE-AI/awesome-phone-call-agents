#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Exit codes are the contract a pipeline gates on:
 *   0  approved
 *   10 rejected by a person
 *   20 no approval (no answer, voicemail, wrong code, window closed)
 *   30 usage or request file error
 *   40 audit verification failed
 *
 * Progress goes to stderr and the result goes to stdout, so `--json` output
 * stays parseable while a CI log still shows what happened.
 */

import { appendFileSync } from "node:fs";
import { verifyAudit } from "./audit.js";
import { createSdkPort, DEFAULT_BASE_URL } from "./calle.js";
import { ConfigError, loadRequest } from "./config.js";
import { renderPreview, renderResult } from "./format.js";
import { runGate } from "./gate.js";
import { generateCode, generatePhrase } from "./secret.js";
import type { GateResult } from "./types.js";

const EXIT_APPROVED = 0;
const EXIT_REJECTED = 10;
const EXIT_NOT_APPROVED = 20;
const EXIT_USAGE = 30;
const EXIT_AUDIT_FAILED = 40;

const USAGE = `Phone approval gate

  preview --request <file> [--json]
      Print the call script, the ladder and the result contract. Places no call.

  request --request <file> --live [--audit <file>] [--json] [--base-url <url>]
      Place one call per approver until someone decides. Needs CALLE_API_KEY.

  verify --audit <file> [--json]
      Re-link the record chain and recompute every recorded verdict.

Exit codes: 0 approved, 10 rejected, 20 no approval, 30 usage error, 40 audit failed.`;

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
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new ConfigError(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "live" || name === "json" || name === "help" || name === "github-output") {
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

/** Publishes the verdict as step outputs when the gate runs inside a workflow. */
function writeGithubOutput(parsed: Parsed, result: GateResult): void {
  const target = process.env.GITHUB_OUTPUT;
  if (!parsed.flags.has("github-output") || target === undefined || target.length === 0) {
    return;
  }
  const lines = [
    `verdict=${result.verdict}`,
    `reason=${result.reason ?? ""}`,
    `approved-by=${result.approved_by.join(",")}`,
    `audit-record-hash=${result.audit_record_hash ?? ""}`,
  ];
  appendFileSync(target, `${lines.join("\n")}\n`, "utf8");
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "" || parsed.flags.has("help") || parsed.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return parsed.command === "" ? EXIT_USAGE : EXIT_APPROVED;
  }

  if (parsed.command === "preview") {
    const request = loadRequest(requireValue(parsed, "request"));
    const sample = { code: generateCode(), phrase: generatePhrase() };
    if (parsed.flags.has("json")) {
      process.stdout.write(
        `${JSON.stringify({ request_id: request.requestId, policy: request.policy, approvers: request.approvers.length }, null, 2)}\n`,
      );
      return EXIT_APPROVED;
    }
    process.stdout.write(`${renderPreview(request, sample)}\n`);
    return EXIT_APPROVED;
  }

  if (parsed.command === "verify") {
    const result = verifyAudit(requireValue(parsed, "audit"));
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      process.stdout.write(`${result.records} record(s) verified. Chain and verdicts hold.\n`);
    } else {
      process.stdout.write(`${result.records} record(s) checked. Problems found:\n`);
      for (const issue of result.issues) {
        process.stdout.write(`  record ${issue.seq}: ${issue.problem}\n`);
      }
    }
    return result.ok ? EXIT_APPROVED : EXIT_AUDIT_FAILED;
  }

  if (parsed.command === "request") {
    const request = loadRequest(requireValue(parsed, "request"));
    if (!parsed.flags.has("live")) {
      throw new ConfigError(
        "request places real phone calls. Run preview first, then add --live when the plan is right.",
      );
    }
    const apiKey = process.env.CALLE_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new ConfigError("CALLE_API_KEY is not set. The gate never reads keys from the request file.");
    }
    const baseUrl = parsed.values["base-url"] ?? process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL;
    const port = await createSdkPort({ apiKey, baseUrl });
    const result = await runGate({
      request,
      port,
      auditPath: parsed.values["audit"] ?? null,
      onProgress: (line) => process.stderr.write(`${line}\n`),
      onSecret: (approver, display) =>
        process.stderr.write(
          `Approval code for ${approver.name} (${approver.id}): ${display}\n` +
            `Read it back on the call. It is single use and expires with this request.\n`,
        ),
    });
    if (parsed.flags.has("json")) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderResult(result)}\n`);
    }
    writeGithubOutput(parsed, result);
    if (result.verdict === "approved") {
      return EXIT_APPROVED;
    }
    return result.verdict === "rejected" ? EXIT_REJECTED : EXIT_NOT_APPROVED;
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

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AppointmentConfirmationResult,
  QUESTIONS_TO_RESOLVE,
} from "../examples/appointment-confirmation.js";
import { getCallRun, isUnauthorizedMcpError, resolveCalleMcpConfig, runCall } from "./calle-mcp.js";
import { DEFAULT_EXTRACTION_SYSTEM_PROMPT, extractStructuredResult } from "./extract-from-transcript.js";
import { maskPhoneNumbersInText, REDACTED_TOKEN_PLACEHOLDER } from "./phone-safety.js";
import { clearPendingPlan, formatPendingPlanSummary, loadPendingPlan, readConfirmTokenFromStdin } from "./pending-plan.js";
import { planAndSave, type PlanCallFn } from "./plan-workflow.js";
import { BedrockReasoningProvider } from "./reasoning/bedrock.js";
import { FakeReasoningProvider } from "./reasoning/fake.js";
import type { ReasoningProvider } from "./reasoning/types.js";

const KNOWN_SCHEMAS = {
  "appointment-confirmation": AppointmentConfirmationResult,
} as const;
type SchemaName = keyof typeof KNOWN_SCHEMAS;

/**
 * Thrown by usage() instead of calling process.exit directly, so that
 * argument-parsing failures go through the same throw/catch path as every
 * other error in a command — in particular so cmdPlan's "clear the pending
 * plan first, no matter what" guarantee actually holds for this case too,
 * and so that guarantee is unit-testable without exiting the test runner.
 * main()'s catch handler is the only place that turns this into a process
 * exit; the usage text is already printed by the time it's thrown.
 */
export class UsageError extends Error {}

function usage(): never {
  console.error(`calle-mcp-result-extractor — demo CLI, not a supported product API

Commands:
  extract --transcript-file <path> [--schema appointment-confirmation] [--provider fake|bedrock]
      Extract a schema-validated structured result from a transcript file.
      No credentials required with --provider fake (the default).

  plan --to <E.164 phone> --region <region> --goal <text>
      Plan a call (no dialing, no side effects, safe to run any time).
      The number is validated locally before anything is sent to CALL-E.
      The confirm_token this returns is saved to a private, restricted-
      permission file — it is never printed and never a CLI argument.

  call [--live]
      Place the call the last "plan" produced, reading its confirm_token
      from that private file (or from stdin, if piped). Without --live
      this prints what would be sent and exits — it never dials by
      accident. Phone numbers in the output are masked.

  status --run-id <id>
      Fetch the current status of a call run. Phone numbers in the
      output are masked.

Every live command requires a prior "calle auth login" (from @call-e/cli).`);
  throw new UsageError();
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

/** Prints a value as masked, redacted-safe JSON — the only way this CLI writes CALL-E responses to stdout. */
function printSafe(value: unknown): void {
  console.log(maskPhoneNumbersInText(JSON.stringify(value, null, 2)));
}

async function cmdExtract(args: string[]) {
  const transcriptFile = flag(args, "transcript-file");
  if (!transcriptFile) usage();
  const schemaName = (flag(args, "schema") ?? "appointment-confirmation") as SchemaName;
  const schema = KNOWN_SCHEMAS[schemaName];
  if (!schema) {
    console.error(`Unknown schema "${schemaName}". Known: ${Object.keys(KNOWN_SCHEMAS).join(", ")}`);
    console.error("For your own schema, import extractStructuredResult() directly instead of the CLI.");
    process.exit(1);
  }
  const providerName = flag(args, "provider") ?? "fake";
  const transcript = readFileSync(transcriptFile, "utf8");

  let reasoning: ReasoningProvider;
  if (providerName === "fake") {
    console.error(
      "Using the fake provider — this returns a canned result and does not call any model. " +
        "Pass --provider bedrock for a real extraction (requires AWS credentials).",
    );
    reasoning = new FakeReasoningProvider().register(schemaName, {
      appointmentConfirmed: true,
      newDate: null,
      newTime: null,
      prepInstructions: null,
      requiresCallback: true,
    });
  } else if (providerName === "bedrock") {
    reasoning = new BedrockReasoningProvider({ region: flag(args, "region") });
  } else {
    console.error(`Unknown provider "${providerName}". Use "fake" or "bedrock".`);
    process.exit(1);
  }

  const result = await extractStructuredResult(reasoning, {
    task: schemaName,
    systemPrompt: DEFAULT_EXTRACTION_SYSTEM_PROMPT,
    transcript,
    questionsToResolve: QUESTIONS_TO_RESOLVE,
    schema,
  });
  // Extraction results are structured app data (appointment confirmed?,
  // reschedule date, …), not raw CALL-E responses, but masking is cheap
  // insurance if a schema ever captures a callback number verbatim.
  printSafe(result);
}

export interface CmdPlanDeps {
  /** Override for tests only — real CLI usage always resolves the real config. */
  resolveConfig?: typeof resolveCalleMcpConfig;
  /** Override for tests only — see plan-workflow.ts. */
  planCallFn?: PlanCallFn;
}

export async function cmdPlan(args: string[], deps: CmdPlanDeps = {}): Promise<void> {
  // Must be the very first thing this function does — strictly before
  // argument parsing (usage() below can throw) and before config resolution
  // (resolveConfig() below can throw too) — so that *nothing* about a new
  // plan attempt, however it fails, can skip invalidating whatever was
  // authorized before it. planAndSave also clears defensively for its own
  // direct callers, but cmdPlan cannot rely on reaching that call at all.
  clearPendingPlan();

  const to = flag(args, "to");
  const region = flag(args, "region");
  const goal = flag(args, "goal");
  if (!to || !region || !goal) usage();

  const resolveConfig = deps.resolveConfig ?? resolveCalleMcpConfig;
  const config = resolveConfig();
  try {
    // planAndSave clears any previously pending plan first too, unconditionally
    // — see its doc comment for why that has to happen before validation or
    // the network call, not just on success.
    const plan = await planAndSave(config, { to, region, goal }, deps.planCallFn);
    // confirm_token authorizes a real call — never print it, CLI arg it, or
    // let it reach shell history. Everything else about the plan is fine to
    // show (still passed through the phone mask, since to_phones round-trips
    // through the server response).
    printSafe({ ...plan, confirm_token: plan.confirm_token ? REDACTED_TOKEN_PLACEHOLDER : null });
    if (plan.ready_to_run) {
      console.error('Plan saved privately. Run "call --live" to place this call, or "call" to preview it.');
    } else {
      console.error(`Not ready to run: ${plan.next_step}`);
    }
  } catch (error) {
    if (isUnauthorizedMcpError(error)) {
      console.error('Not authenticated. Run "npx @call-e/cli auth login" first.');
      process.exit(1);
    }
    throw error;
  }
}

async function cmdCall(args: string[]) {
  const pending = loadPendingPlan();
  if (!pending) {
    console.error('No pending plan found. Run "plan" first.');
    process.exit(1);
  }
  const isLive = args.includes("--live");

  // Preview never needs the token itself, only the plan that's actually
  // stored — so it never touches stdin, which would otherwise risk blocking
  // on it in a non-interactive environment for a command that has no side
  // effects. The summary always reflects what's on file, not a plan id
  // alone, so there's no way to confirm a call you can't actually see.
  if (!isLive) {
    console.log(
      `Preview only (default). Would call run_call for:\n${formatPendingPlanSummary(pending)}\n` +
        "Pass --live to actually place the call — this is a genuine outbound phone call.",
    );
    return;
  }

  const stdinToken = await readConfirmTokenFromStdin();
  const confirmToken = stdinToken ?? pending.confirmToken;

  // The same faithful, masked summary is shown immediately before the real
  // dial too — the last checkpoint before an irreversible action, and it can
  // be a while since "plan" ran, in a different terminal, so this is not
  // redundant with the preview above.
  console.error(`About to place a genuine outbound call for:\n${formatPendingPlanSummary(pending)}`);
  const config = resolveCalleMcpConfig();
  const run = await runCall(config, pending.planId, confirmToken);
  clearPendingPlan(); // confirm_token is single-use; don't leave it around for accidental reuse.
  printSafe(run);
}

async function cmdStatus(args: string[]) {
  const runId = flag(args, "run-id");
  if (!runId) usage();
  const config = resolveCalleMcpConfig();
  const run = await getCallRun(config, runId);
  printSafe(run);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "extract":
      return cmdExtract(rest);
    case "plan":
      return cmdPlan(rest);
    case "call":
      return cmdCall(rest);
    case "status":
      return cmdStatus(rest);
    default:
      usage();
  }
}

// Only run as a real CLI invocation when this file is the actual entry
// point (`node cli.js ...`) — not when it's imported as a module, which the
// test suite does to exercise cmdPlan() directly. Without this guard,
// importing this file for tests would also execute main() for real, against
// the test runner's own argv, and its failure path would set
// process.exitCode = 1 regardless of what the tests actually assert.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    if (error instanceof UsageError) {
      // usage() already printed the help text; nothing more to say.
      process.exitCode = 1;
      return;
    }
    // Every other path in this file prints through the phone mask; this
    // catch-all must too, since any thrown error (including ones this file
    // didn't anticipate) can end up here and still be printed to the user.
    const rendered = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(maskPhoneNumbersInText(rendered));
    process.exitCode = 1;
  });
}

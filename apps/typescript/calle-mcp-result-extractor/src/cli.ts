#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  AppointmentConfirmationResult,
  QUESTIONS_TO_RESOLVE,
} from "../examples/appointment-confirmation.js";
import { getCallRun, isUnauthorizedMcpError, planCall, resolveCalleMcpConfig, runCall } from "./calle-mcp.js";
import { DEFAULT_EXTRACTION_SYSTEM_PROMPT, extractStructuredResult } from "./extract-from-transcript.js";
import { assertE164, maskPhoneNumbersInText, REDACTED_TOKEN_PLACEHOLDER } from "./phone-safety.js";
import { clearPendingPlan, loadPendingPlan, readConfirmTokenFromStdin, savePendingPlan } from "./pending-plan.js";
import { BedrockReasoningProvider } from "./reasoning/bedrock.js";
import { FakeReasoningProvider } from "./reasoning/fake.js";
import type { ReasoningProvider } from "./reasoning/types.js";

const KNOWN_SCHEMAS = {
  "appointment-confirmation": AppointmentConfirmationResult,
} as const;
type SchemaName = keyof typeof KNOWN_SCHEMAS;

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
  process.exit(1);
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

async function cmdPlan(args: string[]) {
  const to = flag(args, "to");
  const region = flag(args, "region");
  const goal = flag(args, "goal");
  if (!to || !region || !goal) usage();
  assertE164(to, "--to");

  const config = resolveCalleMcpConfig();
  try {
    const plan = await planCall(config, { toPhones: [to], region, goal });
    if (plan.ready_to_run && plan.confirm_token) {
      savePendingPlan({
        planId: plan.plan_id,
        confirmToken: plan.confirm_token,
        toPhones: [to],
        region,
        goal,
        createdAt: new Date().toISOString(),
      });
    }
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
  const isLive = args.includes("--live");

  // Preview never needs the token itself, only proof a plan exists — so it
  // never touches stdin, which would otherwise risk blocking on it in a
  // non-interactive environment for a command that has no side effects.
  if (!isLive) {
    if (!pending) {
      console.error('No pending plan found. Run "plan" first.');
      process.exit(1);
    }
    console.log(
      `Preview only (default). Would call run_call for plan ${pending.planId}. ` +
        "Pass --live to actually place the call — this is a genuine outbound phone call.",
    );
    return;
  }

  const stdinToken = await readConfirmTokenFromStdin();
  const confirmToken = stdinToken ?? pending?.confirmToken;
  const planId = pending?.planId;
  if (!confirmToken || !planId) {
    console.error(
      'No pending plan found and no confirm_token piped on stdin. Run "plan" first, ' +
        "or pipe a token: some-source | node cli.js call --live",
    );
    process.exit(1);
  }

  const config = resolveCalleMcpConfig();
  const run = await runCall(config, planId, confirmToken);
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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

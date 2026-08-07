#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  AppointmentConfirmationResult,
  QUESTIONS_TO_RESOLVE,
} from "../examples/appointment-confirmation.js";
import { getCallRun, isUnauthorizedMcpError, planCall, resolveCalleMcpConfig, runCall } from "./calle-mcp.js";
import { DEFAULT_EXTRACTION_SYSTEM_PROMPT, extractStructuredResult } from "./extract-from-transcript.js";
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

  call --plan-id <id> --confirm-token <token> [--live]
      Place the call planCall produced. Without --live this prints what
      would be sent and exits — it never dials by accident.

  status --run-id <id>
      Fetch the current status of a call run.

Every live command requires a prior "calle auth login" (from @call-e/cli).`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
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
  console.log(JSON.stringify(result, null, 2));
}

async function cmdPlan(args: string[]) {
  const to = flag(args, "to");
  const region = flag(args, "region");
  const goal = flag(args, "goal");
  if (!to || !region || !goal) usage();
  const config = resolveCalleMcpConfig();
  try {
    const plan = await planCall(config, { toPhones: [to], region, goal });
    console.log(JSON.stringify(plan, null, 2));
    if (!plan.ready_to_run) {
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
  const planId = flag(args, "plan-id");
  const confirmToken = flag(args, "confirm-token");
  if (!planId || !confirmToken) usage();
  if (!args.includes("--live")) {
    console.log(
      `Preview only (default). Would call run_call with plan_id=${planId}. ` +
        "Pass --live to actually place the call — this is a genuine outbound phone call.",
    );
    return;
  }
  const config = resolveCalleMcpConfig();
  const run = await runCall(config, planId, confirmToken);
  console.log(JSON.stringify(run, null, 2));
}

async function cmdStatus(args: string[]) {
  const runId = flag(args, "run-id");
  if (!runId) usage();
  const config = resolveCalleMcpConfig();
  const run = await getCallRun(config, runId);
  console.log(JSON.stringify(run, null, 2));
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

import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertAuthorizedTarget, parseAuthorizedTargets } from "./authorized-targets.js";
import { loadCallTask, parseCallTaskVariant, type CallTaskVariant } from "./call-task.js";
import {
  cancellationDisclosureToVerdict,
  normalizeLiveExecutionError,
} from "./first-call-scenario.js";
import { createPinnedCalleClient, executeAuthorizedCall } from "./live-executor.js";
import { redactSensitiveContent } from "./sensitive-content.js";

const preflight = await loadPreflight(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CallSuite preflight error: ${message}`);
  console.error("Exit code: 3");
  console.error("No call was placed and no workflow regression was recorded.");
  process.exit(3);
});
const { live, dryRun, variant, callTask, apiKey, phone, authorizedTargets, region, locale } = preflight;

const resultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attendance_outcome", "cancellation_fee_disclosed"],
  properties: {
    attendance_outcome: {
      type: "string",
      enum: ["confirmed", "declined", "unknown"],
    },
    cancellation_fee_disclosed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
    },
  },
} as const;

console.log(`Mode: ${live ? "LIVE — one authorized call" : "DRY RUN — no call"}`);
console.log(`Variant: ${variant}`);
console.log(`Task: ${callTask.path}`);
console.log(`Target: ${maskPhone(phone)}`);
console.log(`Routing: ${region} / ${locale}`);
console.log("Result fields: attendance_outcome, cancellation_fee_disclosed");

if (dryRun) {
  console.log("Configuration is valid. No network request or phone call was made.");
  process.exit(0);
}

try {
  const execution = await executeAuthorizedCall({
    apiKey,
    target: phone,
    authorizedTargets,
    region,
    locale,
    task: callTask.content,
    resultSchema,
    toVerdict: cancellationDisclosureToVerdict,
  }, createPinnedCalleClient);
  const { call, events, result: normalized } = execution;
  const sanitized = redactSensitiveContent({ call, events }, [apiKey]);
  const artifactDirectory = resolve("artifacts");
  const artifactPath = resolve(artifactDirectory, `reminder-call.${variant}.${call.id}.sanitized.json`);

  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");

  console.log(`Status: ${readField(call, "status")}`);
  console.log(`Task completed: ${readField(call, "taskCompleted", "task_completed")}`);
  console.log(`Structured result: ${JSON.stringify(readField(call, "structuredResult", "structured_result"))}`);
  console.log(`Sanitized artifact: ${artifactPath}`);

  console.log(`Normalized verdict: ${normalized.verdict}`);
  console.log(`Exit code: ${normalized.exitCode}`);
  process.exitCode = normalized.exitCode;
} catch (error) {
  const normalized = normalizeLiveExecutionError();
  const errorCode = readField(error, "code");
  const safeErrorCode = redactSensitiveContent(errorCode, [apiKey]);
  const errorLabel = typeof safeErrorCode === "string" ? ` (${safeErrorCode})` : "";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = redactSensitiveContent(rawMessage, [apiKey]);

  console.error(`Live execution error${errorLabel}: ${safeMessage}`);
  console.error(`Normalized verdict: ${normalized.verdict}`);
  console.error(`Exit code: ${normalized.exitCode}`);
  console.error("No workflow regression was recorded. No automatic retry will be attempted.");
  process.exitCode = normalized.exitCode;
}

function parseArguments(args: string[]): {
  live: boolean;
  dryRun: boolean;
  variant: CallTaskVariant;
} {
  let mode: "live" | "dry-run" | undefined;
  let variant: CallTaskVariant | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live" || argument === "--dry-run") {
      if (mode) throw new Error("Choose exactly one mode: --dry-run or --live.");
      mode = argument === "--live" ? "live" : "dry-run";
      continue;
    }

    if (argument === "--variant") {
      if (variant) throw new Error("--variant may be provided only once.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--variant requires good or concise-regression.");
      }
      variant = parseCallTaskVariant(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument '${argument ?? ""}'.`);
  }

  if (!mode) throw new Error("Choose exactly one mode: --dry-run or --live.");
  if (!variant) throw new Error("--variant requires good or concise-regression.");

  return { live: mode === "live", dryRun: mode === "dry-run", variant };
}

async function loadPreflight(args: string[]) {
  const parsed = parseArguments(args);
  const callTask = await loadCallTask(parsed.variant);
  const apiKey = requireEnvironmentVariable("CALLE_API_KEY");
  const phone = requireEnvironmentVariable("CALLSUITE_TEST_PHONE");
  const authorizedTargets = parseAuthorizedTargets(process.env.CALLSUITE_AUTHORIZED_TARGETS);
  const region = process.env.CALLSUITE_TEST_REGION?.trim() || "IN";
  const locale = process.env.CALLSUITE_TEST_LOCALE?.trim() || "en-IN";

  assertAuthorizedTarget(phone, authorizedTargets);
  return { ...parsed, callTask, apiKey, phone, authorizedTargets, region, locale };
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing or empty.`);
  }
  return value;
}

function maskPhone(value: string): string {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}${"*".repeat(value.length - 7)}${value.slice(-4)}`;
}

function readField(value: unknown, ...keys: string[]): unknown {
  if (!value || typeof value !== "object") return "unavailable";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return "unavailable";
}

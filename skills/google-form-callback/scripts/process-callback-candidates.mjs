#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Usage:
  node skills/google-form-callback/scripts/process-callback-candidates.mjs [options]

Options:
  --input <file>                   Extraction output JSON from extract-callback-candidates.mjs. Use "-" for stdin.
  --state <file>                   State JSON file used for responseId dedupe.
  --dry-run                        Print pending call candidates without changing state.
  --execute                        Place one real CALL-E call for each pending candidate.
  --approved-real-calls            Required with --execute; means the dry-run pending list was explicitly approved.
  --calle-bin <bin>                CALL-E binary. Defaults to "calle".
  --calle-arg <arg>                Extra argv before CALL-E subcommands. Repeatable.
  --poll                           Poll CALL-E status until terminal.
  --poll-interval-ms <number>      Poll interval. Defaults to 10000.
  --call-timeout-ms <number>       Polling timeout. Defaults to 900000.
  --writeback <file>               Write template-defined result/summary records for Google Sheets writeback.
  --writeback-local                POST writeback records through the local Google OAuth adapter after calls finish. Requires --writeback.
  --google-credentials <file>      Google OAuth desktop client JSON for --writeback-local.
  --google-token <file>            Local Google OAuth token cache path for --writeback-local.
  --writeback-url <url>            POST writeback records to an Apps Script Web App after calls finish.
  --writeback-token-env <name>     Env var containing the Google Apps Script API token.
                                  Defaults to GOOGLE_FORM_CALLBACK_API_TOKEN, then GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN.
  --post-writeback <file>          POST an existing writeback JSON file without placing calls.
  --mark-processed <responseId>    Mark a response ID as processed. Can be passed multiple times.
  --status <value>                 Status to record with --mark-processed. Defaults to processed.
  --call-run-id <value>            Optional provider call run ID to store with the response.
  --note <value>                   Optional note to store with the response.
  --help                           Show this help.

State shape:
  {
    "processedResponseIds": ["..."],
    "processedResponses": {
      "...": {
        "status": "processed",
        "processedAt": "2026-05-25T00:00:00.000Z",
        "callRunId": "optional",
        "note": "optional"
      }
    }
  }
`;

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "VOICEMAIL",
  "BUSY",
  "EXPIRED",
]);

function parseArgs(argv) {
  const result = {
    dryRun: false,
    execute: false,
    approvedRealCalls: false,
    calleBin: "calle",
    calleArgs: [],
    markProcessed: [],
    poll: false,
    pollIntervalMs: 10000,
    callTimeoutMs: 900000,
    writebackLocal: false,
    writebackTokenEnv: "GOOGLE_FORM_CALLBACK_API_TOKEN",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      result.execute = true;
      continue;
    }
    if (arg === "--approved-real-calls") {
      result.approvedRealCalls = true;
      continue;
    }
    if (arg === "--poll") {
      result.poll = true;
      continue;
    }
    if (arg === "--writeback-local") {
      result.writebackLocal = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;

    switch (key) {
      case "input":
        result.input = next;
        break;
      case "state":
        result.state = next;
        break;
      case "calle-bin":
        result.calleBin = next;
        break;
      case "calle-arg":
        result.calleArgs.push(next);
        break;
      case "poll-interval-ms":
        result.pollIntervalMs = Number(next);
        break;
      case "call-timeout-ms":
        result.callTimeoutMs = Number(next);
        break;
      case "writeback":
        result.writeback = next;
        break;
      case "google-credentials":
        result.googleCredentials = next;
        break;
      case "google-token":
        result.googleToken = next;
        break;
      case "writeback-url":
        result.writebackUrl = next;
        break;
      case "writeback-token-env":
        result.writebackTokenEnv = next;
        break;
      case "post-writeback":
        result.postWriteback = next;
        break;
      case "mark-processed":
        result.markProcessed.push(next);
        break;
      case "status":
        result.status = next;
        break;
      case "call-run-id":
        result.callRunId = next;
        break;
      case "note":
        result.note = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function readJson(pathName) {
  const text = pathName === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(pathName, "utf8");
  return JSON.parse(text);
}

function writeJson(pathName, value) {
  const dir = path.dirname(path.resolve(pathName));
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(pathName)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, pathName);
}

async function postJson(url, payload, tokenEnvName) {
  let token = process.env[tokenEnvName];
  let resolvedTokenEnvName = tokenEnvName;
  if (!token && tokenEnvName === "GOOGLE_FORM_CALLBACK_API_TOKEN") {
    token = process.env.GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN;
    resolvedTokenEnvName = "GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN";
  }
  if (!token) {
    const fallback =
      tokenEnvName === "GOOGLE_FORM_CALLBACK_API_TOKEN"
        ? " or GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN"
        : "";
    throw new Error(`${tokenEnvName}${fallback} is required when using --writeback-url`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "writeback",
      ...payload,
      token,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`writeback POST failed with HTTP ${response.status}: ${text}`);
  }

  const result = text ? JSON.parse(text) : {};
  if (result && result.ok === false) {
    throw new Error(`writeback POST failed: ${result.error || "unknown error"}`);
  }

  return {
    tokenEnv: resolvedTokenEnvName,
    response: result,
  };
}

function postLocalWriteback(writebackPath, options) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.join(scriptDir, "google-local-api-client.mjs");
  const args = [scriptPath, "--action", "writeback", "--writeback", writebackPath];
  if (options.googleCredentials) {
    args.push("--credentials", options.googleCredentials);
  }
  if (options.googleToken) {
    args.push("--token", options.googleToken);
  }

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `local Google writeback failed with exit ${result.status}: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function readState(pathName) {
  if (!pathName || !fs.existsSync(pathName)) {
    return {
      processedResponseIds: [],
      processedResponses: {},
    };
  }

  const state = readJson(pathName);
  const processedResponses =
    state.processedResponses && typeof state.processedResponses === "object"
      ? { ...state.processedResponses }
      : {};
  const ids = new Set();

  if (Array.isArray(state.processedResponseIds)) {
    state.processedResponseIds.forEach((id) => ids.add(String(id)));
  }

  Object.keys(processedResponses).forEach((id) => ids.add(String(id)));

  return {
    ...state,
    processedResponseIds: [...ids].sort(),
    processedResponses,
  };
}

function writeState(pathName, state) {
  if (!pathName) {
    throw new Error("--state is required when writing state");
  }
  writeJson(pathName, state);
}

function processedSet(state) {
  return new Set([
    ...(state.processedResponseIds || []).map(String),
    ...Object.keys(state.processedResponses || {}),
  ]);
}

function redactProviderRequest(providerRequest, candidate) {
  if (!providerRequest || typeof providerRequest !== "object") {
    return providerRequest;
  }

  const phones = Array.isArray(providerRequest.to_phones) ? providerRequest.to_phones : [];
  let goal = providerRequest.goal;
  for (const phone of phones) {
    if (goal && candidate?.maskedPhoneNumber) {
      goal = goal.split(phone).join(candidate.maskedPhoneNumber);
    }
  }

  return {
    ...providerRequest,
    goal,
    to_phones: undefined,
  };
}

function pendingCandidates(extraction, state) {
  const processed = processedSet(state);
  const candidates = Array.isArray(extraction.candidates) ? extraction.candidates : [];
  return candidates.filter((candidate) => !processed.has(String(candidate.responseId)));
}

function buildDryRun(extraction, state) {
  const processed = processedSet(state);
  const candidates = Array.isArray(extraction.candidates) ? extraction.candidates : [];
  const pending = [];
  const alreadyProcessed = [];

  for (const candidate of candidates) {
    if (processed.has(String(candidate.responseId))) {
      alreadyProcessed.push({
        formId: candidate.formId,
        responseId: candidate.responseId,
        status: candidate.status,
        templateName: candidate.templateName,
        maskedPhoneNumber: candidate.maskedPhoneNumber,
        recipientName: candidate.recipientName,
      });
      continue;
    }

    pending.push({
      formId: candidate.formId,
      responseId: candidate.responseId,
      status: candidate.status,
      templateName: candidate.templateName,
      maskedPhoneNumber: candidate.maskedPhoneNumber,
      recipientName: candidate.recipientName,
      providerRequest: redactProviderRequest(candidate.providerRequest, candidate),
    });
  }

  return {
    summary: {
      candidateCount: candidates.length,
      pendingCount: pending.length,
      alreadyProcessedCount: alreadyProcessed.length,
      skippedCount: Array.isArray(extraction.skipped) ? extraction.skipped.length : 0,
    },
    pending,
    alreadyProcessed,
    skipped: extraction.skipped || [],
  };
}

function markProcessed(state, responseIds, metadata) {
  const now = new Date().toISOString();
  const ids = new Set((state.processedResponseIds || []).map(String));
  const processedResponses = {
    ...(state.processedResponses || {}),
  };

  for (const responseId of responseIds) {
    const id = String(responseId);
    ids.add(id);
    processedResponses[id] = {
      status: metadata.status || "processed",
      processedAt: now,
    };

    if (metadata.callRunId) {
      processedResponses[id].callRunId = metadata.callRunId;
    }
    if (metadata.note) {
      processedResponses[id].note = metadata.note;
    }
  }

  return {
    ...state,
    processedResponseIds: [...ids].sort(),
    processedResponses,
  };
}

function runCommand(base, extraArgs) {
  const [bin, ...prefixArgs] = base;
  const result = spawnSync(bin, [...prefixArgs, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      CALLE_SOURCE: process.env.CALLE_SOURCE || "awesome_phone_call_skill",
      CALLE_INTEGRATION: process.env.CALLE_INTEGRATION || "google_form_callback",
      CALLE_INTEGRATION_VERSION: process.env.CALLE_INTEGRATION_VERSION || "0.1.0",
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Command exited with ${result.status}`);
  }

  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function structuredCallResult(output) {
  return (
    output.status_result?.structuredContent ||
    output.result?.structuredContent ||
    output.structuredContent ||
    output
  );
}

function callRunId(output, structured) {
  return output.run_id || output.runId || structured.run_id || structured.runId || structured.call_id || "";
}

function callStatus(structured) {
  return String(structured.status || structured.state || "").toUpperCase();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function callSummary(structured) {
  const result = structured.result && typeof structured.result === "object" ? structured.result : {};
  return firstNonEmptyString(
    result.post_summary,
    result.summary,
    structured.post_summary,
    structured.summary
  );
}

function writebackFieldNames(candidate) {
  return {
    result: candidate.writebackFields?.result || "call_result",
    summary: candidate.writebackFields?.summary || "call_summary",
  };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function startCall(candidate, calleBase) {
  const request = candidate.providerRequest || {};
  const toPhones = Array.isArray(request.to_phones) ? request.to_phones : [];
  if (toPhones.length !== 1) {
    throw new Error(`Candidate ${candidate.responseId} must have exactly one to_phones value`);
  }
  if (!request.goal) {
    throw new Error(`Candidate ${candidate.responseId} is missing providerRequest.goal`);
  }

  const args = ["call", "start", "--to-phone", toPhones[0], "--goal", request.goal];
  if (request.language) {
    args.push("--language", request.language);
  }
  if (request.region) {
    args.push("--region", request.region);
  }

  return runCommand(calleBase, args);
}

function pollCall(runId, calleBase, options) {
  const startedAt = Date.now();
  let latestOutput = null;

  while (Date.now() - startedAt <= options.callTimeoutMs) {
    sleep(options.pollIntervalMs);
    latestOutput = runCommand(calleBase, ["call", "status", "--run-id", runId]);
    const structured = structuredCallResult(latestOutput);
    const status = callStatus(structured);
    if (TERMINAL_STATUSES.has(status)) {
      return latestOutput;
    }
  }

  return latestOutput;
}

async function executePending(extraction, state, options) {
  if (!options.approvedRealCalls) {
    throw new Error("--approved-real-calls is required with --execute");
  }
  if (!options.state) {
    throw new Error("--state is required with --execute");
  }
  if ((options.writeback || options.writebackUrl || options.writebackLocal) && !options.poll) {
    throw new Error("--poll is required with --writeback, --writeback-local, or --writeback-url so result and summary fields are captured after the call ends");
  }
  if (options.writebackLocal && !options.writeback) {
    throw new Error("--writeback is required with --writeback-local");
  }

  const calleBase = [options.calleBin, ...options.calleArgs];
  const pending = pendingCandidates(extraction, state);
  const results = [];
  let nextState = state;

  for (const candidate of pending) {
    let output = startCall(candidate, calleBase);
    let structured = structuredCallResult(output);
    let status = callStatus(structured);
    let runId = callRunId(output, structured);

    if (options.poll && runId && !TERMINAL_STATUSES.has(status)) {
      const polled = pollCall(runId, calleBase, options);
      if (polled) {
        output = polled;
        structured = structuredCallResult(output);
        status = callStatus(structured) || status;
        runId = callRunId(output, structured) || runId;
      }
    }

    const summary = callSummary(structured);
    const fields = writebackFieldNames(candidate);
    const record = {
      formId: candidate.formId || "",
      responseId: candidate.responseId,
      responseIndex: candidate.responseIndex,
      createTime: candidate.createTime || "",
      lastSubmittedTime: candidate.lastSubmittedTime || "",
      resultField: fields.result,
      summaryField: fields.summary,
      [fields.result]: status || "STARTED",
      [fields.summary]: summary || "Not available.",
    };
    results.push(record);

    nextState = markProcessed(nextState, [candidate.responseId], {
      status: record[fields.result].toLowerCase(),
      callRunId: runId,
      note: record[fields.summary],
    });
    writeState(options.state, nextState);
  }

  const writebackPayload = {
    results,
  };
  let writebackPostResult = null;
  let localWritebackResult = null;

  if (options.writeback) {
    writeJson(options.writeback, writebackPayload);
  }
  if (options.writebackLocal) {
    localWritebackResult = postLocalWriteback(options.writeback, options);
  }
  if (options.writebackUrl) {
    writebackPostResult = await postJson(
      options.writebackUrl,
      writebackPayload,
      options.writebackTokenEnv
    );
  }

  return {
    summary: {
      attemptedCount: pending.length,
      resultCount: results.length,
      statePath: options.state,
      writebackPath: options.writeback || null,
      localWritebackPosted: Boolean(options.writebackLocal),
      writebackPosted: Boolean(options.writebackUrl),
      localWritebackResult,
      writebackPostResult,
    },
    results: results.map((result) => ({
      ...result,
      [result.summaryField || "call_summary"]: result[result.summaryField || "call_summary"]
        ? "[redacted in process summary]"
        : "",
    })),
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  try {
    const state = readState(args.state);

    if (args.postWriteback) {
      if (!args.writebackUrl && !args.writebackLocal) {
        throw new Error("--writeback-url or --writeback-local is required with --post-writeback");
      }
      const payload = args.writebackUrl ? readJson(args.postWriteback) : null;
      const postResult = args.writebackUrl
        ? await postJson(args.writebackUrl, payload, args.writebackTokenEnv)
        : null;
      const localResult = args.writebackLocal
        ? postLocalWriteback(args.postWriteback, args)
        : null;
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            writebackPath: args.postWriteback,
            localWritebackPosted: Boolean(args.writebackLocal),
            writebackPosted: Boolean(args.writebackUrl),
            localWritebackResult: localResult,
            writebackPostResult: postResult,
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (args.markProcessed.length > 0) {
      const nextState = markProcessed(state, args.markProcessed, {
        status: args.status,
        callRunId: args.callRunId,
        note: args.note,
      });
      writeState(args.state, nextState);
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            markedResponseIds: args.markProcessed,
            statePath: args.state,
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (!args.input) {
      throw new Error("--input is required for --dry-run or --execute");
    }
    if (args.dryRun && args.execute) {
      throw new Error("Choose either --dry-run or --execute");
    }
    if (!args.dryRun && !args.execute) {
      throw new Error("Choose --dry-run, --execute, or --mark-processed");
    }

    const extraction = readJson(args.input);
    const output = args.execute
      ? await executePending(extraction, state, args)
      : buildDryRun(extraction, state);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const HELP = `Usage:
  node skills/google-form-callback/scripts/google-form-api-client.mjs [options]

Options:
  --url <url>                 Deployed Google Apps Script Web App URL.
  --action <name>             API action: health, export, or writeback. Defaults to health.
  --form-id <id>              Google Form ID for export. Repeat for multiple forms.
  --submitted-after <time>    Include responses submitted at or after this RFC3339 UTC time.
  --submitted-before <time>   Include responses submitted before this RFC3339 UTC time.
  --writeback <file>          Writeback JSON file for the writeback action.
  --output <file>             Output JSON file. Defaults to stdout.
  --token-env <name>          Env var containing the shared API token.
                              Defaults to GOOGLE_FORM_CALLBACK_API_TOKEN, then GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN.
  --print-envelope            Print the full API response envelope for export instead of only response.data.
  --help                      Show this help.

Examples:
  GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \\
  node skills/google-form-callback/scripts/google-form-api-client.mjs \\
    --url "https://script.google.com/macros/s/.../exec" \\
    --action export \\
    --form-id "FORM_ID" \\
    --output form-export.json

  GOOGLE_FORM_CALLBACK_API_TOKEN="same-token" \\
  node skills/google-form-callback/scripts/google-form-api-client.mjs \\
    --url "https://script.google.com/macros/s/.../exec" \\
    --action writeback \\
    --writeback callback-writeback.json
`;

function parseArgs(argv) {
  const result = {
    action: "health",
    formIds: [],
    printEnvelope: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--print-envelope") {
      result.printEnvelope = true;
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
      case "url":
        result.url = next;
        break;
      case "action":
        result.action = next;
        break;
      case "form-id":
        result.formIds.push(next);
        break;
      case "submitted-after":
        result.submittedAfter = next;
        break;
      case "submitted-before":
        result.submittedBefore = next;
        break;
      case "writeback":
        result.writeback = next;
        break;
      case "output":
        result.output = next;
        break;
      case "token-env":
        result.tokenEnv = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function readJson(pathName) {
  return JSON.parse(fs.readFileSync(pathName, "utf8"));
}

function writeJson(pathName, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!pathName || pathName === "-") {
    process.stdout.write(text);
    return;
  }

  const dir = path.dirname(path.resolve(pathName));
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(pathName)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, pathName);
}

function resolveTokenEnvName(explicitName) {
  if (explicitName) {
    return explicitName;
  }
  return "GOOGLE_FORM_CALLBACK_API_TOKEN";
}

function parseRfc3339Utc(value, optionName) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/[zZ]$/.test(text)) {
    throw new Error(`${optionName} must be an RFC3339 UTC timestamp ending in Z`);
  }
  const millis = Date.parse(text);
  if (Number.isNaN(millis)) {
    throw new Error(`${optionName} must be a valid RFC3339 UTC timestamp`);
  }
  return {
    text: text.replace(/z$/, "Z"),
    millis,
  };
}

function parseResponseTimeWindow(args) {
  const submittedAfter = parseRfc3339Utc(args.submittedAfter, "--submitted-after");
  const submittedBefore = parseRfc3339Utc(args.submittedBefore, "--submitted-before");
  if (submittedAfter && submittedBefore && submittedAfter.millis >= submittedBefore.millis) {
    throw new Error("--submitted-after must be earlier than --submitted-before");
  }
  return {
    submittedAfter: submittedAfter?.text || undefined,
    submittedBefore: submittedBefore?.text || undefined,
  };
}

function buildPayload(args) {
  if (!["health", "export", "writeback"].includes(args.action)) {
    throw new Error(`Unsupported action: ${args.action}`);
  }

  if (args.action === "export") {
    if (args.formIds.length === 0) {
      throw new Error("--form-id is required with --action export");
    }
    const timeWindow = parseResponseTimeWindow(args);
    return {
      action: "export",
      formIds: args.formIds,
      ...(timeWindow.submittedAfter ? { submittedAfter: timeWindow.submittedAfter } : {}),
      ...(timeWindow.submittedBefore ? { submittedBefore: timeWindow.submittedBefore } : {}),
    };
  }

  if (args.action === "writeback") {
    if (!args.writeback) {
      throw new Error("--writeback is required with --action writeback");
    }
    const writeback = readJson(args.writeback);
    if (!Array.isArray(writeback.results)) {
      throw new Error("--writeback file must contain a results array");
    }
    return {
      action: "writeback",
      results: writeback.results,
    };
  }

  return { action: "health" };
}

async function postJson(url, payload, tokenEnvName) {
  let token = process.env[tokenEnvName];
  if (!token && tokenEnvName === "GOOGLE_FORM_CALLBACK_API_TOKEN") {
    token = process.env.GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN;
  }
  if (!token) {
    const fallback =
      tokenEnvName === "GOOGLE_FORM_CALLBACK_API_TOKEN"
        ? " or GOOGLE_FORM_CALLBACK_WRITEBACK_TOKEN"
        : "";
    throw new Error(`${tokenEnvName}${fallback} is required`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      token,
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`API POST failed with HTTP ${response.status}: ${text}`);
  }
  if (data && data.ok === false) {
    throw new Error(`API action failed: ${data.error || "unknown error"}`);
  }
  return data;
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

  if (!args.url) {
    console.error("--url is required");
    console.error(HELP);
    process.exit(2);
  }

  const tokenEnvName = resolveTokenEnvName(args.tokenEnv);
  const payload = buildPayload(args);
  const response = await postJson(args.url, payload, tokenEnvName);
  const output =
    args.action === "export" && !args.printEnvelope ? response.data : response;
  writeJson(args.output, output);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

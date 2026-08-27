#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReminderArgs, validateReminderInput } from "./validate-reminder-input.mjs";

const HELP = `Usage:
  node skills/call-reminder/scripts/render-runtime-prompt.mjs [options]

Required options:
  --cadence <value>
  --local-time <HH:MM>
  --timezone <IANA timezone>
  --phone-number <E.164 number>
  --message <text>
  --client-adapter-id <id>

Optional:
  --calle-command <command>         Resolved CALL-E command. Defaults to pinned npx placeholder.
  --late-run-window-minutes <n>     Defaults to 30.
  --input <file>                    Read JSON input from a file. Use "-" for stdin.
  --help                           Show this help.
`;

const DEFAULT_CALLE_COMMAND = "npx -y @call-e/cli@<repo-current-version>";

function renderTemplate(template, values) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`No value provided for template variable: ${key}`);
    }
    return String(values[key]);
  });
}

function loadTemplate() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(scriptDir, "../references/runtime-prompt.md");
  const text = fs.readFileSync(templatePath, "utf8");
  const fenceStart = text.indexOf("```text");
  if (fenceStart === -1) {
    throw new Error("runtime-prompt.md must contain a text fenced template");
  }
  const bodyStart = text.indexOf("\n", fenceStart);
  const fenceEnd = text.indexOf("\n```", bodyStart + 1);
  if (fenceEnd === -1) {
    throw new Error("runtime-prompt.md has an unterminated text fenced template");
  }
  return text.slice(bodyStart + 1, fenceEnd);
}

function main() {
  let parsed;
  try {
    parsed = parseReminderArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exit(2);
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }

  if (!parsed.clientAdapterId) {
    console.error(JSON.stringify({ ok: false, errors: ["clientAdapterId is required"] }, null, 2));
    process.exit(1);
  }

  const result = validateReminderInput(parsed);
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
    process.exit(1);
  }

  const value = result.value;
  const template = loadTemplate();
  const prompt = renderTemplate(template, {
    cadence: value.cadence,
    local_time: value.localTime,
    timezone: value.timezone,
    phone_number: value.phoneNumber,
    reminder_message: value.reminderMessage,
    late_run_window_minutes: value.lateRunWindowMinutes,
    calle_command: value.calleCommand || DEFAULT_CALLE_COMMAND,
    client_adapter_id: value.clientAdapterId,
  });

  process.stdout.write(prompt);
  if (!prompt.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

main();

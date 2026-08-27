#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HELP = `Usage:
  node skills/call-reminder/scripts/validate-reminder-input.mjs [options]

Options:
  --input <file>                    Read JSON input from a file. Use "-" for stdin.
  --cadence <value>                 Reminder cadence, such as daily.
  --local-time <HH:MM>              Local scheduled time in 24-hour format.
  --timezone <IANA timezone>        IANA timezone, such as America/New_York.
  --phone-number <E.164 number>     Destination number, such as +15550101234.
  --message <text>                  Reminder message.
  --reminder-message <text>         Reminder message.
  --late-run-window-minutes <n>     Late-run skip window. Defaults to 30.
  --client-adapter-id <id>          Optional adapter id.
  --calle-command <command>         Optional resolved CALL-E command.
  --help                           Show this help.
`;

const E164_RE = /^\+[1-9]\d{6,14}$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IANA_TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/;

export function parseReminderArgs(argv) {
  const result = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
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
      case "cadence":
        result.cadence = next;
        break;
      case "local-time":
        result.localTime = next;
        break;
      case "timezone":
        result.timezone = next;
        break;
      case "phone-number":
        result.phoneNumber = next;
        break;
      case "message":
      case "reminder-message":
        result.reminderMessage = next;
        break;
      case "late-run-window-minutes":
        result.lateRunWindowMinutes = Number(next);
        break;
      case "client-adapter-id":
        result.clientAdapterId = next;
        break;
      case "calle-command":
        result.calleCommand = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (result.input) {
    const inputText =
      result.input === "-"
        ? fs.readFileSync(0, "utf8")
        : fs.readFileSync(result.input, "utf8");
    const fromFile = JSON.parse(inputText);
    return { ...fromFile, ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== "input")) };
  }

  return result;
}

export function validateReminderInput(input) {
  const errors = [];
  const normalized = {
    cadence: input.cadence,
    localTime: input.localTime,
    timezone: input.timezone,
    phoneNumber: input.phoneNumber,
    reminderMessage: input.reminderMessage,
    lateRunWindowMinutes: input.lateRunWindowMinutes ?? 30,
    clientAdapterId: input.clientAdapterId,
    calleCommand: input.calleCommand,
  };

  if (!normalized.cadence) {
    errors.push("cadence is required");
  }

  if (!normalized.localTime) {
    errors.push("localTime is required");
  } else if (!LOCAL_TIME_RE.test(normalized.localTime)) {
    errors.push("localTime must be HH:MM in 24-hour format");
  }

  if (!normalized.timezone) {
    errors.push("timezone is required");
  } else if (!IANA_TZ_RE.test(normalized.timezone) && normalized.timezone !== "UTC") {
    errors.push("timezone must be an IANA timezone such as America/New_York");
  }

  if (!normalized.phoneNumber) {
    errors.push("phoneNumber is required");
  } else if (!E164_RE.test(normalized.phoneNumber)) {
    errors.push("phoneNumber must be E.164 and include a country code");
  }

  if (!normalized.reminderMessage || !String(normalized.reminderMessage).trim()) {
    errors.push("reminderMessage is required");
  }

  if (!Number.isInteger(normalized.lateRunWindowMinutes)) {
    errors.push("lateRunWindowMinutes must be an integer");
  } else if (normalized.lateRunWindowMinutes < 1 || normalized.lateRunWindowMinutes > 1440) {
    errors.push("lateRunWindowMinutes must be between 1 and 1440");
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length === 0 ? normalized : null,
  };
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

  const result = validateReminderInput(parsed);
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({ ok: true, value: result.value }, null, 2)}\n`);
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  main();
}

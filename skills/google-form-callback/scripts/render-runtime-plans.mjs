#!/usr/bin/env node

import fs from "node:fs";

const HELP = `Usage:
  node skills/google-form-callback/scripts/render-runtime-plans.mjs [options]

Options:
  --config <file>              JSON config. Use "-" for stdin.
  --runtime-template <file>    Runtime prompt markdown. Defaults to skills/google-form-callback/references/runtime-prompt.md.
  --help                       Show this help.

Config shape:
  {
    "schedulePrompt": "Every day at 6pm",
    "timezone": "Asia/Shanghai",
    "authPreflightOk": true,
    "approvedRealCalls": true,
    "templatePath": "skills/google-form-callback/template.md",
    "stateDir": ".callback-state",
    "writebackDir": ".callback-writeback",
    "runDir": ".callback-runs",
    "submittedAfter": "2026-05-27T00:00:00Z",
    "submittedBefore": "2026-05-28T00:00:00Z",
    "writebackLocal": true,
    "writebackUrl": "https://script.google.com/macros/s/.../exec",
    "writebackTokenEnv": "GOOGLE_FORM_CALLBACK_API_TOKEN",
    "forms": [
      { "formId": "FORM_ID", "name": "Commercial Ice Machine Quote Request" }
    ]
  }
`;

const DEFAULT_RUNTIME_TEMPLATE = "skills/google-form-callback/references/runtime-prompt.md";

function parseArgs(argv) {
  const result = {
    runtimeTemplate: DEFAULT_RUNTIME_TEMPLATE,
  };

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
      case "config":
        result.config = next;
        break;
      case "runtime-template":
        result.runtimeTemplate = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function readText(pathName) {
  return pathName === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(pathName, "utf8");
}

function readJson(pathName) {
  return JSON.parse(readText(pathName));
}

function slugify(value) {
  return String(value || "form")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "form";
}

function parseRfc3339Utc(value, label) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!/[zZ]$/.test(text)) {
    throw new Error(`${label} must be an RFC3339 UTC timestamp ending in Z`);
  }
  const millis = Date.parse(text);
  if (Number.isNaN(millis)) {
    throw new Error(`${label} must be a valid RFC3339 UTC timestamp`);
  }
  return {
    text: text.replace(/z$/, "Z"),
    millis,
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function extractRuntimeTemplate(markdown) {
  const match = markdown.match(/```text\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : markdown.trim();
}

function render(template, values) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key) => values[key] || "");
}

function responseWindowArgs(timeWindow) {
  const args = [];
  if (timeWindow.submittedAfter) {
    args.push(`--submitted-after ${shellQuote(timeWindow.submittedAfter.text)}`);
  }
  if (timeWindow.submittedBefore) {
    args.push(`--submitted-before ${shellQuote(timeWindow.submittedBefore.text)}`);
  }
  return args.join(" ");
}

function resolveResponseWindow(config, form, approvedRealCalls) {
  const configuredSubmittedAfter = form.submittedAfter || config.submittedAfter;
  const configuredSubmittedBefore = form.submittedBefore || config.submittedBefore;
  const submittedAfter = parseRfc3339Utc(
    configuredSubmittedAfter || (approvedRealCalls ? new Date().toISOString() : null),
    "submittedAfter"
  );
  const submittedBefore = parseRfc3339Utc(configuredSubmittedBefore, "submittedBefore");

  if (submittedAfter && submittedBefore && submittedAfter.millis >= submittedBefore.millis) {
    throw new Error("submittedAfter must be earlier than submittedBefore");
  }

  return {
    submittedAfter,
    submittedBefore,
    generatedSubmittedAfter: !configuredSubmittedAfter && Boolean(submittedAfter),
  };
}

function writebackSinkArgs(config) {
  const args = [];
  if (config.writebackLocal !== false) {
    args.push("--writeback-local");
  }
  if (config.writebackUrl) {
    args.push(`--writeback-url ${shellQuote(config.writebackUrl)}`);
  }
  if (config.writebackTokenEnv) {
    args.push(`--writeback-token-env ${shellQuote(config.writebackTokenEnv)}`);
  }
  return args.join(" ");
}

function buildPlans(config, runtimeTemplate) {
  const forms = Array.isArray(config.forms) ? config.forms : [];
  if (forms.length === 0) {
    throw new Error("config.forms must include at least one form");
  }

  const schedulePrompt = config.schedulePrompt || config.schedule || "";
  if (!schedulePrompt) {
    throw new Error("config.schedulePrompt is required");
  }
  if (config.authPreflightOk !== true) {
    throw new Error("config.authPreflightOk must be true. Run preflight-auth.mjs before rendering scheduler plans.");
  }

  const timezone = config.timezone || "UTC";
  const templatePath = config.templatePath || "skills/google-form-callback/template.md";
  const stateDir = config.stateDir || ".callback-state";
  const writebackDir = config.writebackDir || ".callback-writeback";
  const runDir = config.runDir || ".callback-runs";
  const approvedRealCalls = config.approvedRealCalls !== false;
  const sinkArgs = writebackSinkArgs(config);

  return forms.map((form) => {
    if (!form.formId) {
      throw new Error("Each form must include formId");
    }
    const formName = form.name || form.formId;
    const slug = slugify(formName);
    const responseWindow = resolveResponseWindow(config, form, approvedRealCalls);
    const windowArgs = responseWindowArgs(responseWindow);
    const values = {
      schedule_prompt: schedulePrompt,
      timezone,
      form_id: form.formId,
      form_name: formName,
      export_path: `${runDir}/${slug}-export.json`,
      candidates_path: `${runDir}/${slug}-candidates.json`,
      state_path: `${stateDir}/${slug}.json`,
      template_path: templatePath,
      writeback_path: `${writebackDir}/${slug}-writeback.json`,
      auth_preflight_ok: "true",
      approved_real_calls: approvedRealCalls ? "true" : "false",
      submitted_after: responseWindow.submittedAfter?.text || "not set",
      submitted_before: responseWindow.submittedBefore?.text || "not set",
      response_window_args: windowArgs,
      writeback_sink_args: sinkArgs,
    };

    return {
      name: `google-form-callback-${slug}`,
      formId: form.formId,
      formName,
      schedulePrompt,
      timezone,
      authPreflightOk: true,
      approvedRealCalls,
      submittedAfter: responseWindow.submittedAfter?.text || null,
      submittedBefore: responseWindow.submittedBefore?.text || null,
      generatedSubmittedAfter: responseWindow.generatedSubmittedAfter,
      statePath: values.state_path,
      exportPath: values.export_path,
      candidatesPath: values.candidates_path,
      writebackPath: values.writeback_path,
      writebackLocal: config.writebackLocal !== false,
      writebackUrl: config.writebackUrl || null,
      prompt: render(runtimeTemplate, values),
    };
  });
}

function main() {
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
  if (!args.config) {
    console.error("--config is required");
    console.error(HELP);
    process.exit(2);
  }

  try {
    const config = readJson(args.config);
    const runtimeTemplate = extractRuntimeTemplate(readText(args.runtimeTemplate));
    const plans = buildPlans(config, runtimeTemplate);
    process.stdout.write(`${JSON.stringify({ plans }, null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();

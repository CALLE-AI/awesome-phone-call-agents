#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HELP = `Usage:
  node skills/google-form-callback/scripts/preflight-auth.mjs [options]

Options:
  --repair-all               Repair Google auth and start CALL-E login when either is missing.
  --repair-google            Run google-auth.mjs login if Google auth is missing or incomplete.
  --start-calle-login        Start CALL-E login if CALL-E auth is not usable.
  --google-credentials <f>   Google OAuth desktop client JSON.
  --google-token <f>         Local Google OAuth token cache path.
  --calle-bin <cmd>          CALL-E CLI command. Defaults to calle.
  --help                     Show this help.

This command performs a no-call preflight. It checks Google Forms/Sheets/Drive
auth and CALL-E auth before form export or phone-call execution.
`;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GOOGLE_AUTH_SCRIPT = path.join(SCRIPT_DIR, "google-auth.mjs");
const REQUIRED_CALLE_ENV = {
  CALLE_SOURCE: "skills_sh",
  CALLE_INTEGRATION: "skills_sh_skill",
  CALLE_INTEGRATION_VERSION: "0.1.0",
};

function parseArgs(argv) {
  const result = {
    repairGoogle: false,
    startCalleLogin: false,
    calleBin: "calle",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--repair-google") {
      result.repairGoogle = true;
      continue;
    }
    if (arg === "--start-calle-login") {
      result.startCalleLogin = true;
      continue;
    }
    if (arg === "--repair-all") {
      result.repairGoogle = true;
      result.startCalleLogin = true;
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
      case "google-credentials":
        result.googleCredentials = next;
        break;
      case "google-token":
        result.googleToken = next;
        break;
      case "calle-bin":
        result.calleBin = next;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    stdio: options.inherit ? "inherit" : "pipe",
  });
}

function parseJsonOutput(result) {
  const text = result.stdout || result.stderr || "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function googleAuthArgs(command, args) {
  const output = [GOOGLE_AUTH_SCRIPT, command];
  if (args.googleCredentials) {
    output.push("--credentials", args.googleCredentials);
  }
  if (args.googleToken) {
    output.push("--token", args.googleToken);
  }
  return output;
}

function googleReady(status) {
  return Boolean(status?.authenticated) && (status.missingScopes || []).length === 0;
}

function googleActionRequired(status) {
  if (!status?.authenticated) {
    return "Run google-auth.mjs login before exporting forms.";
  }
  if ((status.missingScopes || []).length > 0) {
    return "Run google-auth.mjs login again to grant the missing Google scopes.";
  }
  return null;
}

function checkGoogle(args) {
  let statusResult = run(process.execPath, googleAuthArgs("status", args));
  let status = parseJsonOutput(statusResult);
  const loginAttempts = [];

  if (!googleReady(status) && args.repairGoogle) {
    const loginResult = run(process.execPath, googleAuthArgs("login", args), { inherit: true });
    loginAttempts.push({
      exitCode: loginResult.status,
      ok: loginResult.status === 0,
    });
    statusResult = run(process.execPath, googleAuthArgs("status", args));
    status = parseJsonOutput(statusResult);
  }

  const ready = googleReady(status);
  return {
    ready,
    status: status || {
      authenticated: false,
      error: statusResult.stderr || statusResult.stdout || "Could not parse google-auth status output.",
    },
    loginAttempts,
    actionRequired: ready ? null : googleActionRequired(status),
  };
}

function calleReady(status) {
  return Boolean(status?.usable);
}

function checkCalle(args) {
  let statusResult = run(args.calleBin, ["auth", "status"], { env: REQUIRED_CALLE_ENV });
  let status = parseJsonOutput(statusResult);
  const loginAttempts = [];

  if (!calleReady(status) && args.startCalleLogin) {
    const loginResult = run(
      args.calleBin,
      ["auth", "login", "--start-only", "--no-browser-open"],
      { env: REQUIRED_CALLE_ENV }
    );
    loginAttempts.push({
      exitCode: loginResult.status,
      ok: loginResult.status === 0,
      result: parseJsonOutput(loginResult) || {
        message: loginResult.stdout || loginResult.stderr || "",
      },
    });
    statusResult = run(args.calleBin, ["auth", "status"], { env: REQUIRED_CALLE_ENV });
    status = parseJsonOutput(statusResult);
  }

  const ready = calleReady(status);
  return {
    ready,
    status: status || {
      usable: false,
      error: statusResult.stderr || statusResult.stdout || "Could not parse CALL-E auth status output.",
    },
    loginAttempts,
    actionRequired: ready
      ? null
      : "Complete CALL-E auth login before executing real phone calls.",
  };
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

  const google = checkGoogle(args);
  const calle = checkCalle(args);
  const ok = google.ready && calle.ready;

  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        google,
        calle,
      },
      null,
      2
    )}\n`
  );

  if (!ok) {
    process.exit(1);
  }
}

main();

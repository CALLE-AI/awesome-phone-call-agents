#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = dirname(scriptDir);
const projectDir = join(pluginDir, "hubspot-project");
const functionsDir = join(projectDir, "src/app/functions");
const workflowActionPath = join(
  projectDir,
  "src/app/workflow-actions/create-call-candidate-hsmeta.json"
);
const workflowEndpointPath = "/hs/serverless/calle/create-call";
const defaultCallEBaseUrl = "https://api.heycall-e.com";
export const minimumNodeVersion = "20.0.0";
export const minimumHubSpotCliVersion = "8.4.0";
const secretNames = [
  "CALL_E_API_KEY",
  "CALL_E_BASE_URL",
  "HUBSPOT_CLIENT_SECRET",
  "HUBSPOT_WORKFLOW_ACTION_URL",
];

function usage() {
  return `Usage:
  node scripts/install-direct-call.mjs --account <hubspot-account-id> --endpoint-url <public-serverless-url> [options]
  node scripts/install-direct-call.mjs --account <hubspot-account-id> --endpoint-host <public-serverless-host> [options]

Required:
  --account <id-or-name>        HubSpot CLI account ID or configured account name.
  --endpoint-url <url>          Full public function URL ending in ${workflowEndpointPath}.

Endpoint shortcut:
  --endpoint-host <host>        Host only. The script appends ${workflowEndpointPath}.

Options:
  --set-secrets-from-env        Add or update HubSpot secrets from environment variables.
  --skip-secrets                Do not check or write HubSpot secrets.
  --skip-validate               Skip 'hs project validate'.
  --skip-upload                 Skip 'hs project upload'.
  --no-build                    Skip serverless bundle generation.
  --message <text>              Upload message.
  --dry-run                     Print planned actions without changing files or HubSpot.
  --help                        Show this help text.

Environment variables for --set-secrets-from-env:
  CALL_E_API_KEY                Required. Never printed by this script.
  CALL_E_BASE_URL               Optional. Defaults to ${defaultCallEBaseUrl}.
  HUBSPOT_CLIENT_SECRET         Required. Find it on the HubSpot app Auth tab; never printed.

The workflow action URL is stored server-side from --endpoint-url or --endpoint-host.`;
}

function readOption(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    account: "",
    endpointUrl: "",
    endpointHost: "",
    setSecretsFromEnv: false,
    skipSecrets: false,
    skipValidate: false,
    skipUpload: false,
    build: true,
    dryRun: false,
    help: false,
    message: "Install CALL-E HubSpot direct-call workflow action",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--account":
        options.account = readOption(argv, index, arg);
        index += 1;
        break;
      case "--endpoint-url":
        options.endpointUrl = readOption(argv, index, arg);
        index += 1;
        break;
      case "--endpoint-host":
        options.endpointHost = readOption(argv, index, arg);
        index += 1;
        break;
      case "--set-secrets-from-env":
        options.setSecretsFromEnv = true;
        break;
      case "--skip-secrets":
        options.skipSecrets = true;
        break;
      case "--skip-validate":
        options.skipValidate = true;
        break;
      case "--skip-upload":
        options.skipUpload = true;
        break;
      case "--no-build":
        options.build = false;
        break;
      case "--message":
        options.message = readOption(argv, index, arg);
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.setSecretsFromEnv && options.skipSecrets) {
    throw new Error("Use either --set-secrets-from-env or --skip-secrets, not both.");
  }
  return options;
}

export function parseAccountInfo(output) {
  const name = String(output).match(/^Account name:[^\S\r\n]*(\S.*)$/m)?.[1]?.trim() || "";
  const id = String(output).match(/^Account ID:[^\S\r\n]*(\d+)[^\S\r\n]*$/m)?.[1] || "";
  if (!name || !id) {
    throw new Error("Could not parse HubSpot account identity.");
  }
  return { name, id };
}

export function assertRequestedAccount(requested, resolved) {
  const expected = String(requested).trim();
  if (expected !== resolved.name && expected !== resolved.id) {
    throw new Error(
      `Requested HubSpot account ${expected} resolved to ${resolved.name} (${resolved.id}). Authenticate the requested account before continuing.`
    );
  }
}

function normalizeHttpsUrl(value, label) {
  const rawValue = String(value).trim();
  if (rawValue.includes("?")) {
    throw new Error(`${label} URL must not include a query string.`);
  }
  if (rawValue.includes("#")) {
    throw new Error(`${label} URL must not include a fragment.`);
  }
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (!parsed.hostname) {
    throw new Error(`${label} must include a hostname.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL must not include credentials.`);
  }
  if (parsed.search) {
    throw new Error(`${label} URL must not include a query string.`);
  }
  if (parsed.hash) {
    throw new Error(`${label} URL must not include a fragment.`);
  }

  return parsed.toString();
}

export function normalizeCallEBaseUrl(value) {
  const rawValue = String(value).trim();
  normalizeHttpsUrl(rawValue, "CALL_E_BASE_URL");
  if (!/^https:\/\/api\.heycall-e\.com\/?$/.test(rawValue)) {
    throw new Error(`CALL_E_BASE_URL must be exactly ${defaultCallEBaseUrl}.`);
  }
  return defaultCallEBaseUrl;
}

function parseVersion(value, label) {
  const normalized = String(value).trim().replace(/^v/i, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(normalized);
  if (!match) {
    throw new Error(`${label} version ${value} is invalid; expected a dotted numeric version.`);
  }
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

export function assertMinimumVersion(actual, minimum, label) {
  const actualParts = parseVersion(actual, label);
  const minimumParts = parseVersion(minimum, label);
  const firstDifference = actualParts.findIndex(
    (part, index) => part !== minimumParts[index]
  );

  if (firstDifference !== -1 && actualParts[firstDifference] < minimumParts[firstDifference]) {
    throw new Error(`${label} must be at least ${minimum}; found ${actual}.`);
  }
}

function extractVersion(output, label) {
  const match = String(output).trim().match(/\bv?\d+(?:\.\d+){0,2}\b/);
  if (!match) {
    throw new Error(`${label} version output did not contain a dotted numeric version.`);
  }
  return String(match[0]).replace(/^v/i, "");
}

export function normalizeEndpointUrl(options) {
  if (options.endpointUrl && options.endpointHost) {
    throw new Error("Use either --endpoint-url or --endpoint-host, not both.");
  }

  const rawUrl = options.endpointUrl
    ? options.endpointUrl
    : options.endpointHost
      ? `https://${String(options.endpointHost).replace(/^https?:\/\//, "").replace(/\/+$/, "")}${workflowEndpointPath}`
      : "";

  if (!rawUrl) {
    throw new Error("Provide --endpoint-url or --endpoint-host.");
  }

  const normalizedUrl = normalizeHttpsUrl(rawUrl, "Endpoint URL");
  const parsed = new URL(normalizedUrl);
  if (parsed.pathname !== workflowEndpointPath) {
    throw new Error(`Endpoint URL must end with ${workflowEndpointPath}.`);
  }
  return normalizedUrl;
}

export function parseSecretList(output) {
  const found = new Set();
  for (const line of String(output).split(/\r?\n/)) {
    const name = line.trim();
    if (secretNames.includes(name)) {
      found.add(name);
    }
  }
  return found;
}

export function assertRequiredSecrets(found) {
  const missing = secretNames.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required HubSpot secrets: ${missing.join(", ")}.`);
  }
}

export function parseInstallStatus(output, exitStatus) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Could not parse HubSpot app install status JSON.");
  }

  if (typeof parsed.isInstalled !== "boolean" || typeof parsed.isInstalledWithCurrentScopes !== "boolean") {
    throw new Error("Could not parse HubSpot app install status JSON.");
  }
  if (![0, 2].includes(exitStatus)) {
    throw new Error(`HubSpot app install status failed with exit code ${exitStatus}.`);
  }

  const isInstalled = parsed.isInstalled;
  const currentScopes = parsed.isInstalledWithCurrentScopes;
  const state = !isInstalled
    ? "manual_install_required"
    : currentScopes
      ? "installed"
      : "reinstall_required";
  return { state, isInstalled, currentScopes };
}

export function buildPostInstallInstructions(account) {
  return [
    "",
    "Post-install HubSpot checks:",
    `- Open the project app Distribution tab for account ${account}.`,
    "- Standard account: use Standard install to install or reinstall the app in that standard account. No developer test install is required for App Card visibility.",
    "- Developer test account: the project-owner administrator uses 'Distribution -> Test installs -> Add test install(s)' and installs the app into the test portal.",
    "- After installation, add the App Card from CRM record customization: Card library -> Card types -> App.",
  ].join("\n");
}

async function configureWorkflowAction(endpointUrl, dryRun, log = console.log) {
  if (dryRun) {
    log(`[dry-run] Would set workflow action URL to ${endpointUrl}`);
    return;
  }
  const metadata = JSON.parse(await readFile(workflowActionPath, "utf8"));
  metadata.config.actionUrl = endpointUrl;
  await writeFile(workflowActionPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  log(`Configured workflow action URL: ${endpointUrl}`);
}

function accountArgs(account) {
  return ["-a", account];
}

export function executeCommand(command, args, options = {}) {
  const spawn = options.spawn || spawnSync;
  const childEnv = { ...(options.env || process.env) };
  delete childEnv.CALL_E_API_KEY;
  delete childEnv.HUBSPOT_CLIENT_SECRET;
  delete childEnv.HUBSPOT_WORKFLOW_ACTION_URL;
  const result = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    env: childEnv,
    input: options.input,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || "",
  };
}

function redactKnownSecrets(value, secretValues) {
  let redacted = String(value || "");
  const secrets = [...new Set(
    secretValues.map((secretValue) => String(secretValue || "").trim()).filter(Boolean)
  )].sort((left, right) => right.length - left.length);
  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted.replace(
    /CALL_E_API_KEY(?:\s*[=:]\s*\S+)?/gi,
    "CALL-E API key [redacted]"
  );
}

function safeDiagnostic(result, secretValues) {
  const parts = [];
  for (const [label, value] of [
    ["stdout", result.stdout],
    ["stderr", result.stderr],
    ["error", result.error],
  ]) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    if (normalized) parts.push(`${label}: ${normalized}`);
  }
  return redactKnownSecrets(parts.join("; "), secretValues).slice(0, 400);
}

function safeCommandLine(executable, args) {
  return [executable, ...args]
    .map((value) => String(value).replace(/CALL_E_API_KEY/gi, "[secret]"))
    .join(" ");
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeCliOutput(output) {
  return String(output)
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "");
}

export function assertSecretMutationConfirmation(action, name, account, result) {
  const actionText = action === "add" ? "was added to" : "was updated in";
  const confirmation = `The secret "${name}" ${actionText} the HubSpot account:`;
  const accountId = escapeRegularExpression(account.id);
  const namedAccount = account.name
    ? `${escapeRegularExpression(account.name)} \\[[^\\]\\r\\n]+\\] \\(${accountId}\\)`
    : "";
  const accountDescription = action === "add"
    ? `(?:${accountId}${namedAccount ? `|${namedAccount}` : ""})`
    : accountId;
  const successLine = new RegExp(
    `^(?:(?:✔ SUCCESS|\\[SUCCESS\\])\\s+)?${escapeRegularExpression(confirmation)} ${accountDescription}$`
  );
  const mutationLine = new RegExp(
    `The secret "${escapeRegularExpression(name)}" was (?:added to|updated in) the HubSpot account:`
  );
  const allowedUpdateExplanation = "Existing serverless functions will start using this new value within 10 seconds.";
  const lines = normalizeCliOutput(`${result.stdout || ""}\n${result.stderr || ""}`)
    .split("\n")
    .filter((line) => line.length > 0);
  const matchingMutationLines = lines.filter((line) => mutationLine.test(line));
  const hasFailureMarker = lines.some((line) => /\b(?:ERROR|FAILED|FAILURE)\b/i.test(line));
  const hasOnlyKnownOutput = lines.every((line) =>
    successLine.test(line) || (action === "update" && line === allowedUpdateExplanation)
  );

  if (
    !hasFailureMarker
    && matchingMutationLines.length === 1
    && successLine.test(matchingMutationLines[0])
    && hasOnlyKnownOutput
  ) return;

  const displayName = name === "CALL_E_API_KEY" ? "CALL-E API key" : name;
  throw new Error(
    `HubSpot CLI did not confirm ${action} of ${displayName} for account ${account.id}.`
  );
}

async function requireSuccessful(command, executable, args, options = {}) {
  const result = await command(executable, args, options);
  const allowedStatuses = options.allowedStatuses || [0];
  if (!allowedStatuses.includes(result.status)) {
    const secretValues = [
      ...(options.secretValues || []),
      String(options.input || "").trim(),
    ];
    const printable = redactKnownSecrets(safeCommandLine(executable, args), secretValues);
    const diagnostic = safeDiagnostic(result, secretValues);
    if (result.status === null && result.error) {
      const startupDiagnostic = diagnostic.replace(/^error:\s*/, "");
      throw new Error(`${printable} failed to start: ${startupDiagnostic || "unknown spawn error"}.`);
    }
    throw new Error(
      `${printable} failed with exit code ${result.status}${diagnostic ? `: ${diagnostic}` : ""}.`
    );
  }
  return result;
}

function prepareSecretPlan(options, env, endpointUrl) {
  if (options.skipSecrets) return { mode: "skip" };
  if (!options.setSecretsFromEnv) return { mode: "check" };

  if (!env.CALL_E_API_KEY) {
    throw new Error("CALL_E_API_KEY is required when using --set-secrets-from-env.");
  }
  if (!env.HUBSPOT_CLIENT_SECRET) {
    throw new Error("HUBSPOT_CLIENT_SECRET is required when using --set-secrets-from-env.");
  }
  return {
    mode: "set",
    values: {
      CALL_E_API_KEY: env.CALL_E_API_KEY,
      CALL_E_BASE_URL: normalizeCallEBaseUrl(env.CALL_E_BASE_URL || defaultCallEBaseUrl),
      HUBSPOT_CLIENT_SECRET: env.HUBSPOT_CLIENT_SECRET,
      HUBSPOT_WORKFLOW_ACTION_URL: endpointUrl,
    },
  };
}

async function preflightSecrets(account, secretPlan, command) {
  if (secretPlan.mode === "skip") return new Set();
  const result = await command("hs", ["secret", "list", ...accountArgs(account.id)]);
  const existing = parseSecretList(result.stdout);
  if (secretPlan.mode === "check") assertRequiredSecrets(existing);
  return existing;
}

async function applySecretPlan(options, account, secretPlan, existing, command, log) {
  if (secretPlan.mode !== "set") return;
  for (const name of secretNames) {
    const action = existing.has(name) ? "update" : "add";
    if (options.dryRun) {
      log(`[dry-run] Would ${action} HubSpot secret ${name === "CALL_E_API_KEY" ? "CALL-E API key" : name}.`);
      continue;
    }
    log(`${existing.has(name) ? "Updating" : "Adding"} HubSpot secret ${name === "CALL_E_API_KEY" ? "CALL-E API key" : name}`);
    const result = await command("hs", ["secret", action, name, ...accountArgs(account.id)], {
      input: `${secretPlan.values[name]}\n`,
    });
    assertSecretMutationConfirmation(action, name, account, result);
  }
}

async function buildValidateAndUpload(options, account, command, log) {
  if (options.build) {
    if (options.dryRun) log("[dry-run] npm run build");
    else await command("npm", ["run", "build"], { cwd: functionsDir });
  }
  if (!options.skipValidate) {
    if (options.dryRun) log(`[dry-run] hs project validate -a ${account.id}`);
    else await command("hs", ["project", "validate", ...accountArgs(account.id)], { cwd: projectDir });
  }
  if (options.skipUpload) return;
  if (options.dryRun) {
    log(`[dry-run] hs project upload -a ${account.id} --force-create --message ${options.message}`);
    return;
  }
  await command("hs", [
    "project", "upload", ...accountArgs(account.id), "--force-create", "--message", options.message,
  ], { cwd: projectDir });
}

function reportState(state, account, log) {
  if (state === "installed") log("Direct-call HubSpot project is uploaded and installed.");
  else if (state === "reinstall_required") {
    log("Direct-call HubSpot project is uploaded, but reinstall is required to apply current scopes.");
    log(buildPostInstallInstructions(account.id));
  } else if (state === "manual_install_required") {
    log("Direct-call HubSpot project is uploaded, but manual app installation is required.");
    log(buildPostInstallInstructions(account.id));
  } else if (state === "upload_skipped") {
    log("Direct-call HubSpot project upload was skipped; remote setup is not complete.");
  } else {
    throw new Error(`Unknown installer completion state: ${state}.`);
  }
  return { state };
}

export async function runInstaller(options, dependencies = {}) {
  const log = dependencies.log || console.log;
  const env = dependencies.env || process.env;
  const nodeVersion = dependencies.nodeVersion || process.version;
  const command = dependencies.command || ((executable, args, commandOptions) =>
    executeCommand(executable, args, { ...commandOptions, env, spawn: dependencies.spawn })
  );
  const secretValues = secretNames.map((name) => env[name]).filter(Boolean);
  const successfulCommand = (executable, args, commandOptions = {}) => requireSuccessful(
    command,
    executable,
    args,
    { ...commandOptions, secretValues }
  );
  const configure = dependencies.configureWorkflowAction || configureWorkflowAction;

  assertMinimumVersion(nodeVersion, minimumNodeVersion, "Node.js");
  const cliVersionResult = await successfulCommand("hs", ["--version"]);
  const cliVersion = extractVersion(
    `${cliVersionResult.stdout}\n${cliVersionResult.stderr}`,
    "HubSpot CLI"
  );
  assertMinimumVersion(cliVersion, minimumHubSpotCliVersion, "HubSpot CLI");

  const accountResult = await successfulCommand("hs", ["account", "info", options.account]);
  const account = parseAccountInfo(accountResult.stdout);
  assertRequestedAccount(options.account, account);
  const endpointUrl = normalizeEndpointUrl(options);
  const secretPlan = prepareSecretPlan(options, env, endpointUrl);
  const existingSecrets = await preflightSecrets(account, secretPlan, successfulCommand);
  if (secretPlan.mode === "set") {
    secretValues.push(...Object.values(secretPlan.values).filter(Boolean));
  }

  await configure(endpointUrl, options.dryRun, log);
  await applySecretPlan(options, account, secretPlan, existingSecrets, successfulCommand, log);
  await buildValidateAndUpload(options, account, successfulCommand, log);
  if (options.skipUpload || options.dryRun) return reportState("upload_skipped", account, log);

  const installResult = await successfulCommand("hs", [
    "project", "app-install-status", ...accountArgs(account.id), "--json",
  ], { cwd: projectDir, allowedStatuses: [0, 2] });
  return reportState(parseInstallStatus(installResult.stdout, installResult.status).state, account, log);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.account) throw new Error("Provide --account.");
  await runInstaller(options);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

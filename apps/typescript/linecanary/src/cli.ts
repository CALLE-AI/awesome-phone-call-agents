/**
 * The linecanary CLI.
 *
 *   linecanary init   [--config path]                      write a starter config
 *   linecanary verify <line-id> [--config path]            prove line ownership
 *   linecanary run    [--config path] [--live] [--only a,b] [--json path]
 *   linecanary report [--config path]                      print stored history
 *
 * Dry-run is the default for `run`; `--live` places real calls. Environment:
 * CALLE_API_KEY (required live), CALLE_BASE_URL (guarded, for the local
 * fake), CALLE_ALLOWED_HOSTS, LINECANARY_SLACK_WEBHOOK via config `env:`.
 * Exit codes: 0 ok · 1 regressions or failures · 2 the run itself broke.
 */

import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { exitCode, formatReport, sendSlack } from "./alert.js";
import { openStore } from "./baseline.js";
import { createSdkPort, DEFAULT_BASE_URL, type CallePort } from "./calle.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { runChecks } from "./runner.js";
import { verifyLine } from "./verify.js";

const USAGE = `usage:
  linecanary init   [--config path]
  linecanary verify <line-id> [--config path]
  linecanary run    [--config path] [--live] [--only id,id] [--json path]
  linecanary report [--config path]`;

interface Flags {
  config: string;
  live: boolean;
  only: string[] | undefined;
  json: string | undefined;
  positional: string[];
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { config: "linecanary.config.json", live: false, only: undefined, json: undefined, positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config" || argument === "--json" || argument === "--only") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new ConfigError(`${argument} needs a value.`);
      }
      index += 1;
      if (argument === "--config") flags.config = value;
      else if (argument === "--json") flags.json = value;
      else flags.only = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    } else if (argument === "--live") {
      flags.live = true;
    } else if (argument.startsWith("--")) {
      throw new ConfigError(`Unknown flag ${argument}.\n${USAGE}`);
    } else {
      flags.positional.push(argument);
    }
  }
  return flags;
}

async function makePort(): Promise<CallePort> {
  const apiKey = process.env.CALLE_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ConfigError("CALLE_API_KEY is not set. Export your CALL-E API key before a live call.");
  }
  const allowed = (process.env.CALLE_ALLOWED_HOSTS ?? "").split(/[\s,]+/).filter((entry) => entry.length > 0);
  return createSdkPort({ apiKey, baseUrl: process.env.CALLE_BASE_URL ?? DEFAULT_BASE_URL, allowedHosts: allowed });
}

const STARTER_CONFIG = join(dirname(new URL(import.meta.url).pathname), "..", "examples", "linecanary.config.example.json");

function commandInit(flags: Flags): number {
  const target = resolve(flags.config);
  if (existsSync(target)) {
    process.stderr.write(`${target} already exists; not overwriting.\n`);
    return 2;
  }
  if (existsSync(STARTER_CONFIG)) {
    copyFileSync(STARTER_CONFIG, target);
  } else {
    writeFileSync(target, JSON.stringify({ lines: [], checks: [] }, null, 2));
  }
  process.stdout.write(`Wrote ${target}. Edit the lines and checks, then run: linecanary verify <line-id>\n`);
  return 0;
}

async function commandVerify(flags: Flags): Promise<number> {
  const lineId = flags.positional[0];
  if (lineId === undefined) {
    process.stderr.write(`verify needs a line id.\n${USAGE}\n`);
    return 2;
  }
  const config = loadConfig(flags.config);
  const line = config.lines.find((candidate) => candidate.id === lineId);
  if (line === undefined) {
    process.stderr.write(`No line ${lineId} in ${flags.config}.\n`);
    return 2;
  }
  const store = openStore(config.baselineDir);
  const port = await makePort();
  const result = await verifyLine(line, port, store);
  process.stdout.write(`${result.detail}\n`);
  return result.ok ? 0 : 1;
}

async function commandRun(flags: Flags): Promise<number> {
  const config: Config = loadConfig(flags.config);
  const store = openStore(config.baselineDir);
  const port = flags.live ? await makePort() : null;
  const report = await runChecks(config, port, store, {
    live: flags.live,
    only: flags.only,
    timeoutMs: 300_000,
    intervalMs: 5_000,
  });
  process.stdout.write(`${formatReport(report)}\n`);
  if (flags.json !== undefined) {
    writeFileSync(flags.json, JSON.stringify(report, null, 2));
  }
  if (flags.live && config.alerts?.slackWebhookUrl !== undefined) {
    try {
      await sendSlack(config.alerts.slackWebhookUrl, report);
    } catch (error) {
      process.stderr.write(`Slack alert failed: ${String(error)}\n`);
    }
  }
  return exitCode(report);
}

function commandReport(flags: Flags): number {
  const config = loadConfig(flags.config);
  const store = openStore(config.baselineDir);
  for (const check of config.checks) {
    const history = store.history(check.id);
    if (history.length === 0) {
      process.stdout.write(`${check.id}: no runs recorded\n`);
      continue;
    }
    process.stdout.write(`${check.id}: ${history.length} run(s)\n`);
    for (const outcome of history.slice(-5)) {
      const timing = outcome.timing.secondsToAnswer === null ? "" : ` answered=${outcome.timing.secondsToAnswer}s`;
      const confidence = outcome.confidence === null ? "" : ` confidence=${outcome.confidence}`;
      process.stdout.write(`  ${outcome.at}  ${outcome.status}${timing}${confidence}\n`);
    }
  }
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  try {
    const flags = parseFlags(rest);
    if (command === "init") {
      return commandInit(flags);
    }
    if (command === "verify") {
      return await commandVerify(flags);
    }
    if (command === "run") {
      return await commandRun(flags);
    }
    if (command === "report") {
      return commandReport(flags);
    }
    process.stderr.write(`${USAGE}\n`);
    return 2;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stderr.write(`Unexpected failure: ${String(error)}\n`);
    return 2;
  }
}

process.exitCode = await main();

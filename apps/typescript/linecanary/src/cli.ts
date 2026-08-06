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
import { discoverLine } from "./discover.js";
import { createAnthropicPort, explainCheck } from "./explain.js";
import { renderStatus } from "./pages.js";
import { runChecks } from "./runner.js";
import { startDashboard } from "./serve.js";
import { buildDashboardState } from "./state.js";
import { verifyLine } from "./verify.js";

const USAGE = `usage:
  linecanary init   [--config path]
  linecanary verify <line-id> [--config path]
  linecanary run    [--config path] [--live] [--only id,id] [--json path]
  linecanary report [--config path]
  linecanary serve  [--config path] [--port n] [--title text]
  linecanary status [--config path] [--html out.html] [--title text] [--line id]
  linecanary explain <check-id> [--config path] [--save]
  linecanary discover <line-id> [--config path] [--out draft.json]`;

interface Flags {
  config: string;
  live: boolean;
  save: boolean;
  explain: boolean;
  line: string | undefined;
  out: string | undefined;
  only: string[] | undefined;
  json: string | undefined;
  html: string | undefined;
  port: number;
  title: string | undefined;
  positional: string[];
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { config: "linecanary.config.json", live: false, save: false, explain: false, line: undefined, out: undefined, only: undefined, json: undefined, html: undefined, port: 4477, title: undefined, positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--config", "--json", "--only", "--html", "--port", "--title", "--line", "--out"].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new ConfigError(`${argument} needs a value.`);
      }
      index += 1;
      if (argument === "--config") flags.config = value;
      else if (argument === "--json") flags.json = value;
      else if (argument === "--html") flags.html = value;
      else if (argument === "--title") flags.title = value;
      else if (argument === "--line") flags.line = value;
      else if (argument === "--out") flags.out = value;
      else if (argument === "--port") {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new ConfigError(`--port must be an integer between 0 and 65535.`);
        }
        flags.port = port;
      } else flags.only = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    } else if (argument === "--live") {
      flags.live = true;
    } else if (argument === "--save") {
      flags.save = true;
    } else if (argument === "--explain") {
      flags.explain = true;
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
  const store = openStore(config.baselineDir, config.historyLimit);
  const port = await makePort();
  const result = await verifyLine(line, port, store);
  process.stdout.write(`${result.detail}\n`);
  return result.ok ? 0 : 1;
}

async function commandRun(flags: Flags): Promise<number> {
  const config: Config = loadConfig(flags.config);
  const store = openStore(config.baselineDir, config.historyLimit);
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
  if (flags.live && flags.explain) {
    const failing = report.runs.filter((run) =>
      run.regressions.some((entry) => entry.kind === "new_failure" || entry.kind === "still_failing"),
    );
    for (const run of failing) {
      try {
        const check = config.checks.find((candidate) => candidate.id === run.planned.checkId)!;
        const history = store.history(check.id);
        const latest = history[history.length - 1];
        const passes = history.filter((entry) => entry.status === "pass");
        const port2 = await createAnthropicPort();
        const note = await explainCheck(
          {
            check,
            latest,
            lastPass: passes.length === 0 ? null : passes[passes.length - 1],
            regressions: run.regressions,
            answerSeconds: history.map((entry) => entry.timing.secondsToAnswer),
          },
          port2,
        );
        store.recordNote({ checkId: check.id, callId: latest.callId, at: new Date().toISOString(), markdown: note });
        process.stdout.write(`AI incident note saved for ${check.id}.\n`);
      } catch (error) {
        process.stderr.write(`explain failed for ${run.planned.checkId}: ${String(error)}\n`);
      }
    }
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
  const store = openStore(config.baselineDir, config.historyLimit);
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

async function commandServe(flags: Flags): Promise<number> {
  const config = loadConfig(flags.config);
  const envPort = process.env.PORT === undefined ? undefined : Number(process.env.PORT);
  const server = await startDashboard(config, {
    port: envPort !== undefined && Number.isInteger(envPort) ? envPort : flags.port,
    host: process.env.HOST,
    statusTitle: flags.title,
    password: process.env.LINECANARY_DASHBOARD_PASSWORD,
  });
  process.stdout.write(`LineCanary dashboard: http://127.0.0.1:${server.port}/\n`);
  process.stdout.write(`Public status page:   http://127.0.0.1:${server.port}/status\n`);
  process.stdout.write(`State as JSON:        http://127.0.0.1:${server.port}/api/state\n`);
  await new Promise(() => undefined); // runs until interrupted
  return 0;
}

function commandStatus(flags: Flags): number {
  const config = loadConfig(flags.config);
  if (flags.line !== undefined && !config.lines.some((line) => line.id === flags.line)) {
    process.stderr.write(`No line ${flags.line} in ${flags.config}.\n`);
    return 2;
  }
  const store = openStore(config.baselineDir, config.historyLimit);
  const state = buildDashboardState(config, store);
  const title = flags.title ?? (flags.line === undefined ? undefined : state.lines.find((line) => line.id === flags.line)?.name);
  const html = renderStatus(state, title, flags.line);
  if (flags.html === undefined) {
    process.stdout.write(html);
  } else {
    writeFileSync(flags.html, html);
    process.stdout.write(`Wrote ${flags.html}\n`);
  }
  return 0;
}

async function commandExplain(flags: Flags): Promise<number> {
  const checkId = flags.positional[0];
  if (checkId === undefined) {
    process.stderr.write(`explain needs a check id.\n${USAGE}\n`);
    return 2;
  }
  const config = loadConfig(flags.config);
  const check = config.checks.find((candidate) => candidate.id === checkId);
  if (check === undefined) {
    process.stderr.write(`No check ${checkId} in ${flags.config}.\n`);
    return 2;
  }
  const store = openStore(config.baselineDir, config.historyLimit);
  const history = store.history(checkId);
  if (history.length === 0) {
    process.stderr.write(`No runs recorded for ${checkId} — run the check first.\n`);
    return 2;
  }
  const latest = history[history.length - 1];
  const passes = history.filter((entry) => entry.status === "pass");
  const lastPass = passes.length === 0 ? null : passes[passes.length - 1];
  const { diffAgainstBaseline } = await import("./diff.js");
  const port = await createAnthropicPort();
  const note = await explainCheck(
    {
      check,
      latest,
      lastPass,
      regressions: diffAgainstBaseline(latest, history.slice(0, -1)),
      answerSeconds: history.map((entry) => entry.timing.secondsToAnswer),
    },
    port,
  );
  process.stdout.write(`${note}\n`);
  if (flags.save) {
    store.recordNote({ checkId, callId: latest.callId, at: new Date().toISOString(), markdown: note });
    process.stdout.write(`\nSaved — the dashboard will show this note while ${latest.callId} is the latest run.\n`);
  }
  return 0;
}

async function commandDiscover(flags: Flags): Promise<number> {
  const lineId = flags.positional[0];
  if (lineId === undefined) {
    process.stderr.write(`discover needs a line id.\n${USAGE}\n`);
    return 2;
  }
  const config = loadConfig(flags.config);
  const line = config.lines.find((candidate) => candidate.id === lineId);
  if (line === undefined) {
    process.stderr.write(`No line ${lineId} in ${flags.config}.\n`);
    return 2;
  }
  process.stdout.write(`Placing one discovery call to ${line.id} to map the caller journey…\n`);
  const calls = await makePort();
  const model = await createAnthropicPort();
  const result = await discoverLine(line, calls, model);
  process.stdout.write(`\nHeard on the line:\n  greeting: ${result.heard.greeting}\n  menu:     ${result.heard.menuOptions}\n  notes:    ${result.heard.notes}\n\n`);
  const draft = JSON.stringify(result.checks, null, 2);
  if (flags.out !== undefined) {
    writeFileSync(flags.out, draft);
    process.stdout.write(`Draft checks written to ${flags.out} — review, adjust, then merge into ${flags.config} under "checks".\n`);
  } else {
    process.stdout.write(`Draft checks — review, adjust, then merge into ${flags.config} under "checks":\n${draft}\n`);
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
    if (command === "serve") {
      return await commandServe(flags);
    }
    if (command === "status") {
      return commandStatus(flags);
    }
    if (command === "explain") {
      return await commandExplain(flags);
    }
    if (command === "discover") {
      return await commandDiscover(flags);
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

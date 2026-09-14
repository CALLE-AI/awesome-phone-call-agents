// still-covered: plan | run | resume | follow-up | serve | report | fake-server
//
// Dry-run is the default everywhere. A live campaign needs SC_MODE=live, CALLE_API_KEY and --confirm
// on the command line, and it is only ever started from this CLI.

import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Call, CalleClient } from "@call-e/calle";
import { createCalleClient, createScreeningCall } from "./calle.js";
import { assertLiveAllowed, forceDryRun, loadConfig, loadDotEnv, type Config } from "./config.js";
import { startFakeCalleServer, type FakeServerHandle } from "./fake-calle-server.js";
import { Ledger } from "./ledger.js";
import { maskPhone } from "./mask.js";
import { CallInbox, Orchestrator } from "./orchestrator.js";
import { planWaves, scoreEnrollee } from "./priority.js";
import { formatWindow, isQuietNow, minutesUntilQuietEnds } from "./quiet-hours.js";
import { applyAllowlist, loadEnrollees, type RegistryLoadReport } from "./registry.js";
import { buildReport } from "./report.js";
import { clearedByData, daysBetween, DEFAULT_RULES_PATH, loadRules, loadState, questionsFor, type Rules, type StateConfig } from "./rules.js";
import { SCREENING_RESULT_SCHEMA } from "./schemas.js";
import { listSampleRegistries, startServer, type ServerHandle } from "./server.js";
import { buildConformanceReport, evaluateProbe, loadProbes, personaToEnrollee, type ProbeResult } from "./probes.js";
import { renderScreeningTask } from "./tasks.js";
import type { Campaign, Enrollee, Wave } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");
const DATA_DIR = join(HERE, "..", "data");
const DEFAULT_REGISTRY = join(DATA_DIR, "enrollees.sample.csv");

const ESC = "\u001b";
const color = {
  bold: (s: string) => `${ESC}[1m${s}${ESC}[22m`,
  dim: (s: string) => `${ESC}[2m${s}${ESC}[22m`,
  green: (s: string) => `${ESC}[32m${s}${ESC}[39m`,
  yellow: (s: string) => `${ESC}[33m${s}${ESC}[39m`,
  red: (s: string) => `${ESC}[31m${s}${ESC}[39m`,
  cyan: (s: string) => `${ESC}[36m${s}${ESC}[39m`,
};

function usage(): never {
  process.stdout.write(`${color.bold("still-covered")} - Medicaid work-requirement exemption screener on CALL-E

Commands
  plan         Load the enrollee list, show who the state's data already clears, plan waves, print the call task. Places no call.
  run          Run an outreach campaign (dry-run by default; live needs --confirm).
  resume       Reattach to an interrupted campaign: settle pending calls, re-place refused tasks, finish the worklist.
  follow-up    Call back the people who asked for a better time and are due.
  serve        Dashboard and webhook receiver; drills can be started from the browser (dry-run only).
  report       Rebuild the outreach report from a campaign ledger.
  probe        Run the conformance probes: scripted adversarial calls, checked against the transcript.
  fake-server  Run the local fake CALL-E API in the foreground.

Options
  --registry <csv>        Enrollee list (default: data/enrollees.sample.csv)
  --state <id>            State configuration in states/ (default from SC_STATE, else example-state)
  --rules <json>          Rules file (default: rules/federal-2027.json)
  --campaign-id <id>      Stable campaign id (used by resume, follow-up, report, serve)
  --title <text>          Campaign title
  --as-of <YYYY-MM-DD>    Date used for deadline arithmetic (default: today in SC_TIMEZONE)
  --due-within <days>     Only people whose coverage check is within this many days
  --wave-size <n>         People per wave (default from SC_WAVE_SIZE)
  --parallel <n>          Waves in flight at once (default 1)
  --confirm               Required for live mode
  --dry-run               Force dry-run whatever the environment says; no call can be placed
  --fast                  Collapse the redial delay (drills)
  --keep-server           Keep the dashboard running after run finishes
  --now                   follow-up: ignore due times
  --only <probe-id>       probe: run a single probe
  --simulate <mode>       probe, dry-run only: "compliant" (default) or "violating" to prove the
                          harness reports a failure when the agent misbehaves
`);
  process.exit(2);
}

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function buildCampaign(config: Config, values: Record<string, string | boolean | undefined>, rules: Rules, state: StateConfig): Campaign {
  const asOf = typeof values["as-of"] === "string" ? values["as-of"] : todayIn(config.timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("--as-of must be YYYY-MM-DD");
  }
  const dueRaw = typeof values["due-within"] === "string" ? Number.parseInt(values["due-within"], 10) : Number.NaN;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return {
    id: typeof values["campaign-id"] === "string" ? values["campaign-id"] : `${state.id}-${asOf}-${stamp}`,
    title: typeof values["title"] === "string" ? values["title"] : `${state.program_name} work-requirement outreach`,
    stateId: state.id,
    rulesId: rules.id,
    source: values["drill"] === true ? "drill" : "manual",
    startedAt: new Date().toISOString(),
    asOf,
    dueWithinDays: Number.isFinite(dueRaw) && dueRaw >= 0 ? dueRaw : null,
  };
}

function loadPeople(config: Config, registryPath: string, campaign: Campaign, log: (s: string) => void): { people: Enrollee[]; report: RegistryLoadReport; excludedNotDue: number } {
  const { people, report } = loadEnrollees(registryPath);
  for (const warning of report.warnings) {
    log(color.dim(`registry: ${warning}`));
  }
  const { kept, skipped } = applyAllowlist(people, config.mode === "live" ? config.liveAllowlist : null);
  for (const person of skipped) {
    log(color.yellow(`registry: ${person.name} (${maskPhone(person.phone)}) is not on SC_LIVE_ALLOWLIST and will not be dialled.`));
  }
  let due = kept;
  if (campaign.dueWithinDays !== null) {
    const limit = campaign.dueWithinDays;
    due = kept.filter((p) => p.checkDate === null || daysBetween(campaign.asOf, p.checkDate) <= limit);
    if (due.length < kept.length) {
      log(color.dim(`${kept.length - due.length} people have a coverage check more than ${limit} days away and are not in this campaign.`));
    }
  }
  return { people: due, report, excludedNotDue: kept.length - due.length };
}

async function ensureFakeServer(config: Config, log: (s: string) => void, fast: boolean): Promise<FakeServerHandle | null> {
  if (config.mode !== "dry-run") {
    return null;
  }
  try {
    const probe = await fetch(`${config.baseUrl}/v1/calls/call_probe`, { headers: { authorization: "Bearer probe" } });
    if (probe.status === 404) {
      log(color.dim(`fake CALL-E server already running at ${config.baseUrl}`));
      return null;
    }
  } catch {
    // not running; start one
  }
  const handle = await startFakeCalleServer({ port: config.fakePort, queueDelayMs: fast ? 400 : 1200, perRecipientMs: fast ? 300 : 900 });
  log(color.dim(`fake CALL-E server started at ${handle.url} (no real calls can be placed in dry-run mode)`));
  return handle;
}

/**
 * Probes are one call at a time with nobody waiting on a dashboard, so they poll rather than run a
 * webhook receiver. A call that never settles is reported as such, never guessed at.
 */
async function pollUntilTerminal(client: CalleClient, callId: string, intervalMs: number, timeoutMs: number): Promise<Call> {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(["completed", "failed", "canceled"]);
  let call = await client.calls.get(callId);
  while (!terminal.has(call.status)) {
    if (Date.now() > deadline) {
      throw new Error(`Call ${callId} did not finish within ${Math.round(timeoutMs / 1000)}s. Nothing is inferred from an unfinished call.`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    call = await client.calls.get(callId);
  }
  return call;
}

/**
 * Quiet hours exist to protect enrollees, and for a campaign there is no override.
 *
 * A conformance probe is not outreach. It can only dial a number on SC_LIVE_ALLOWLIST, the operator
 * presses Enter to make that phone ring seconds beforehand, and nobody on the enrollee list is
 * reachable by this command at all. So a probe warns rather than refuses - and only ever when an
 * allowlist is set, which is enforced separately before anything is dialled.
 */
function warnQuietHoursForProbe(config: Config, allowlisted: string, log: (s: string) => void): void {
  if (!isQuietNow(new Date(), config.quietHours, config.timeZone)) {
    return;
  }
  const window = `${formatWindow(config.quietHours)} ${config.timeZone}`;
  log(color.yellow(`Quiet hours (${window}) are in effect. A campaign would be refused outright.`));
  log(color.yellow(`Probes continue: they can only dial ${maskPhone(allowlisted)} from SC_LIVE_ALLOWLIST, and you confirm each call before it rings.`));
}

/** Coverage outreach is never urgent enough to call at night. There is no override. */
function enforceQuietHours(config: Config, log: (s: string) => void): void {
  if (!isQuietNow(new Date(), config.quietHours, config.timeZone)) {
    return;
  }
  const wait = minutesUntilQuietEnds(new Date(), config.quietHours, config.timeZone);
  const window = `${formatWindow(config.quietHours)} ${config.timeZone}`;
  if (config.mode !== "live") {
    log(color.yellow(`Quiet hours (${window}) are in effect: a live campaign would be refused for another ${wait} min. Drill continues.`));
    return;
  }
  throw new Error(`Quiet hours (${window}) are in effect for another ${wait} min. Coverage outreach is never urgent enough to call at night; try again later.`);
}

function webhookUrlFor(config: Config, server: ServerHandle, log: (s: string) => void): string | null {
  if (config.mode === "dry-run") {
    return `${server.url}/calle/webhook`;
  }
  if (config.publicUrl) {
    return `${config.publicUrl.replace(/\/$/, "")}/calle/webhook`;
  }
  log(color.yellow("SC_PUBLIC_URL is not set; CALL-E cannot deliver webhooks, so Still Covered will poll for results instead."));
  return null;
}

interface RunDeps {
  config: Config;
  server: ServerHandle;
  inbox: CallInbox;
  rules: Rules;
  state: StateConfig;
  log: (s: string) => void;
}

interface RunSettings {
  waveSize: number;
  parallel: number;
  fast: boolean;
  confirm: boolean;
}

async function executeRun(deps: RunDeps, campaign: Campaign, registryPath: string, settings: RunSettings): Promise<{ campaignId: string; reportPath: string }> {
  const { config, server, inbox, rules, state, log } = deps;
  assertLiveAllowed(config, settings.confirm);
  enforceQuietHours(config, log);
  const { people, report, excludedNotDue } = loadPeople(config, registryPath, campaign, log);
  if (people.length === 0) {
    throw new Error("Nobody to include after loading the enrollee list.");
  }
  const ledgerPath = join(config.dataDir, campaign.id, "ledger.jsonl");
  if (existsSync(ledgerPath)) {
    throw new Error(`Campaign ${campaign.id} already has a ledger. Use resume --campaign-id ${campaign.id}, follow-up, or a new --campaign-id.`);
  }
  const ledger = new Ledger(ledgerPath);
  server.setLedger(ledger);
  if (config.mode === "live") {
    const toCall = people.filter((p) => !clearedByData(p, rules).cleared).length;
    log(color.red(color.bold(`LIVE MODE: up to ${toCall} people will be phoned through CALL-E on behalf of ${state.caller_org}, and credit will be consumed.`)));
  }
  const orchestrator = new Orchestrator({
    config,
    client: createCalleClient(config),
    ledger,
    inbox,
    campaign,
    rules,
    state,
    people,
    registryReport: report,
    excludedNotDue,
    webhookUrl: webhookUrlFor(config, server, log),
    waveSize: settings.waveSize,
    parallelWaves: settings.parallel,
    retryDelayMs: settings.fast || config.mode === "dry-run" ? 0 : 30 * 60 * 1000,
    pollIntervalMs: config.mode === "dry-run" ? 500 : 3000,
    log,
  });
  await orchestrator.run();
  const reportPath = join(config.dataDir, campaign.id, "outreach-report.md");
  writeFileSync(reportPath, buildReport(ledger.projection), "utf8");
  ledger.append({ type: "campaign.closed", at: new Date().toISOString(), reportPath });
  log(`${color.bold("Outreach report:")} ${reportPath}`);
  return { campaignId: campaign.id, reportPath };
}

function orchestratorFromLedger(deps: RunDeps, ledger: Ledger, settings: RunSettings): Orchestrator {
  const projection = ledger.projection;
  if (!projection.campaign) {
    throw new Error("Ledger has no declared campaign.");
  }
  const people = [...projection.people.values()];
  return new Orchestrator({
    config: deps.config,
    client: createCalleClient(deps.config),
    ledger,
    inbox: deps.inbox,
    campaign: projection.campaign,
    rules: deps.rules,
    state: deps.state,
    people,
    registryReport: { loaded: people.length, skippedNoConsent: 0, skippedDoNotCall: 0, skippedInvalidPhone: 0, skippedDuplicatePhone: 0, skippedMissingFields: 0, warnings: [] },
    webhookUrl: webhookUrlFor(deps.config, deps.server, deps.log),
    waveSize: settings.waveSize,
    parallelWaves: settings.parallel,
    pollIntervalMs: deps.config.mode === "dry-run" ? 500 : 3000,
    log: deps.log,
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      state: { type: "string" },
      rules: { type: "string" },
      "campaign-id": { type: "string" },
      title: { type: "string" },
      "as-of": { type: "string" },
      "due-within": { type: "string" },
      "wave-size": { type: "string" },
      parallel: { type: "string" },
      confirm: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      fast: { type: "boolean", default: false },
      "keep-server": { type: "boolean", default: false },
      drill: { type: "boolean", default: false },
      now: { type: "boolean", default: false },
      only: { type: "string" },
      simulate: { type: "string" },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (!command || values.help) {
    usage();
  }
  // --dry-run overrides everything, including SC_MODE=live in .env. `npm run demo` passes it, so a
  // command named "demo" can never dial no matter how the operator's environment is configured.
  const loaded = loadConfig();
  const config: Config = values["dry-run"] === true ? forceDryRun(loaded) : loaded;
  const rules = loadRules(values.rules ?? DEFAULT_RULES_PATH);
  const state = loadState(values.state ?? config.stateId);
  const log = (line: string): void => {
    if (!values.quiet) {
      process.stdout.write(`${line}\n`);
    }
  };
  const registryPath = values.registry ?? DEFAULT_REGISTRY;
  const settings: RunSettings = {
    waveSize: values["wave-size"] ? Number.parseInt(values["wave-size"], 10) : config.waveSize,
    parallel: values.parallel ? Number.parseInt(values.parallel, 10) : 1,
    fast: values.fast,
    confirm: values.confirm,
  };
  const printDashboard = (server: ServerHandle): void => {
    const suffix = config.dashboardToken ? `/?token=${config.dashboardToken}` : "";
    log(`${color.bold("Dashboard:")} ${server.url}${suffix}${config.dashboardToken ? color.dim("  (token required; keep this URL private)") : ""}`);
  };
  const ledgerFor = (): Ledger => {
    const id = values["campaign-id"];
    if (!id) {
      throw new Error(`${command} needs --campaign-id.`);
    }
    const ledgerPath = join(config.dataDir, id, "ledger.jsonl");
    if (!existsSync(ledgerPath)) {
      throw new Error(`No ledger for campaign ${id}.`);
    }
    return new Ledger(ledgerPath);
  };

  switch (command) {
    case "plan": {
      const campaign = buildCampaign(config, values, rules, state);
      const { people } = loadPeople(config, registryPath, campaign, log);
      log(`${color.bold(campaign.title)} - ${state.state_name}, calls on behalf of ${state.caller_org}, as of ${campaign.asOf}, mode ${config.mode}. ${color.dim("No call is placed by plan.")}`);
      if (isQuietNow(new Date(), config.quietHours, config.timeZone)) {
        log(color.yellow(`Quiet hours ${formatWindow(config.quietHours)} ${config.timeZone} are in effect right now; a live campaign would be refused.`));
      }
      log("");
      const callable: Enrollee[] = [];
      for (const person of people) {
        const clearance = clearedByData(person, rules);
        if (clearance.cleared) {
          log(color.green(`Cleared by state data, no call: ${person.name} (${clearance.reason})`));
        } else {
          callable.push(person);
        }
      }
      log("");
      for (const wave of planWaves(callable, campaign.asOf, settings.waveSize, 1)) {
        log(color.cyan(`Wave ${wave.index} (priority ${wave.priority})`));
        for (const id of wave.personIds) {
          const person = callable.find((p) => p.id === id);
          if (!person) {
            continue;
          }
          const p = scoreEnrollee(person, campaign.asOf);
          const q = questionsFor(rules, person, campaign.asOf).length;
          log(`  ${person.name.padEnd(18)} ${maskPhone(person.phone).padEnd(16)} ${person.locale.padEnd(6)} ${String(q).padStart(1)} questions  ${color.dim(p.factors.join(", "))}`);
        }
      }
      const first = callable[0];
      if (first) {
        log("");
        log(color.bold(`Rendered CALL-E task for ${first.name}:`));
        log(color.dim(renderScreeningTask(rules, state, first, campaign.asOf)));
      }
      log("");
      log(color.bold("recipient_result_schema:"));
      log(color.dim(JSON.stringify(SCREENING_RESULT_SCHEMA, null, 2)));
      return;
    }
    case "run": {
      const campaign = buildCampaign(config, values, rules, state);
      const fake = await ensureFakeServer(config, log, values.fast);
      const inbox = new CallInbox();
      const server = await startServer({ config, inbox, publicDir: PUBLIC_DIR, registryDir: DATA_DIR });
      printDashboard(server);
      try {
        await executeRun({ config, server, inbox, rules, state, log }, campaign, registryPath, settings);
        if (values["keep-server"]) {
          log(color.dim("Dashboard kept running. Press Ctrl+C to stop."));
          await new Promise(() => undefined);
        }
      } finally {
        if (!values["keep-server"]) {
          await server.close();
          await fake?.close();
        }
      }
      return;
    }
    case "resume":
    case "follow-up": {
      const ledger = ledgerFor();
      assertLiveAllowed(config, values.confirm);
      enforceQuietHours(config, log);
      const fake = await ensureFakeServer(config, log, true);
      const inbox = new CallInbox();
      const server = await startServer({ config, inbox, publicDir: PUBLIC_DIR, registryDir: DATA_DIR });
      server.setLedger(ledger);
      printDashboard(server);
      try {
        const deps: RunDeps = { config, server, inbox, rules, state, log };
        const orchestrator = orchestratorFromLedger(deps, ledger, settings);
        if (command === "resume") {
          await orchestrator.resume();
        } else {
          const due = [...ledger.projection.states.values()].filter((s) => s.outcome === "declined" && s.followUpDueAt !== null && (values.now || Date.parse(s.followUpDueAt) <= Date.now()));
          if (due.length === 0) {
            log("No follow-ups are due.");
          } else {
            await orchestrator.followUp(due.map((s) => s.personId));
          }
        }
        const reportPath = join(config.dataDir, ledger.projection.campaign?.id ?? "campaign", "outreach-report.md");
        writeFileSync(reportPath, buildReport(ledger.projection), "utf8");
        if (!ledger.projection.closed) {
          ledger.append({ type: "campaign.closed", at: new Date().toISOString(), reportPath });
        }
        log(`${color.bold("Report updated:")} ${reportPath}`);
      } finally {
        await server.close();
        await fake?.close();
      }
      return;
    }
    case "serve": {
      const fake = await ensureFakeServer(config, log, true);
      const inbox = new CallInbox();
      let active: Promise<unknown> | null = null;
      const ref: { server: ServerHandle | null } = { server: null };
      const server = await startServer({
        config,
        inbox,
        publicDir: PUBLIC_DIR,
        registryDir: DATA_DIR,
        isRunning: () => active !== null,
        startDrill: async (request) => {
          if (active) {
            throw new Error("A drill is already running.");
          }
          if (!ref.server) {
            throw new Error("server not ready");
          }
          const campaign = buildCampaign(config, { ...values, drill: true, ...(request.asOf ? { "as-of": request.asOf } : { "as-of": "2026-09-14" }), "campaign-id": undefined }, rules, state);
          const registry = request.registry && listSampleRegistries(DATA_DIR).includes(basename(request.registry)) ? join(DATA_DIR, basename(request.registry)) : registryPath;
          active = executeRun({ config, server: ref.server, inbox, rules, state, log }, campaign, registry, { ...settings, fast: true, confirm: false })
            .catch((err: Error) => log(color.red(`drill failed: ${err.message}`)))
            .finally(() => {
              active = null;
            });
          return { campaignId: campaign.id };
        },
      });
      ref.server = server;
      if (values["campaign-id"]) {
        const ledgerPath = join(config.dataDir, values["campaign-id"], "ledger.jsonl");
        if (existsSync(ledgerPath)) {
          server.setLedger(new Ledger(ledgerPath));
        }
      }
      printDashboard(server);
      log(color.dim(`mode ${config.mode}; drills from the browser are dry-run only`));
      process.on("SIGINT", () => {
        void server.close().then(() => fake?.close()).then(() => process.exit(0));
      });
      await new Promise(() => undefined);
      return;
    }
    case "report": {
      const ledger = ledgerFor();
      const markdown = buildReport(ledger.projection);
      const reportPath = join(config.dataDir, ledger.projection.campaign?.id ?? "campaign", "outreach-report.md");
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, markdown, "utf8");
      process.stdout.write(markdown);
      return;
    }
    case "probe": {
      // One scripted adversarial call at a time. In live mode the operator has to be holding the
      // phone and reading the part, so nothing is dialled until they say they are ready.
      assertLiveAllowed(config, values.confirm === true);
      const probes = loadProbes().filter((p) => typeof values["only"] !== "string" || p.id === values["only"]);
      if (probes.length === 0) {
        throw new Error(`No probe matched --only ${String(values["only"])}. Available: ${loadProbes().map((p) => p.id).join(", ")}`);
      }
      const phone = config.mode === "live" ? config.liveAllowlist?.[0] : "+14155550301";
      if (phone === undefined) {
        throw new Error("A live probe run needs SC_LIVE_ALLOWLIST set to the number that will answer. Refusing to dial anything else.");
      }
      // Only reachable once the allowlist has produced a number, so the warning can name it.
      warnQuietHoursForProbe(config, phone, log);
      const fake = await ensureFakeServer(config, log, true);
      const client = createCalleClient(config);
      const asOf = typeof values["as-of"] === "string" ? values["as-of"] : todayIn(config.timeZone);
      const runStamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
      const rawSimulate = typeof values["simulate"] === "string" ? values["simulate"] : "compliant";
      if (rawSimulate !== "compliant" && rawSimulate !== "violating") {
        throw new Error(`--simulate must be "compliant" or "violating", got ${rawSimulate}`);
      }
      // Only meaningful in dry-run: on a real call the agent behaves however it behaves.
      const simulateMode: "compliant" | "violating" | null = config.mode === "dry-run" ? rawSimulate : null;
      if (simulateMode === "violating") {
        log(color.yellow("Simulating a MISBEHAVING agent: every probe below is expected to FAIL. A harness that cannot report a failure is decoration."));
      }
      const results: ProbeResult[] = [];
      const rl = config.mode === "live" ? createInterface({ input: process.stdin, output: process.stdout }) : null;
      try {
        for (const [index, probe] of probes.entries()) {
          log("");
          log(color.bold(`Probe ${index + 1}/${probes.length}: ${probe.title}`));
          log(color.dim(probe.why));
          log(`${color.cyan("Your part:")} ${probe.testerScript}`);
          if (rl !== null) {
            await rl.question(color.yellow(`Press Enter when you are ready for ${maskPhone(phone)} to ring. `));
          }
          const person = personaToEnrollee(probe, phone);
          // Each probe run gets its own campaign id. The idempotency key is campaign+person+attempt, and a
// probe is deliberately re-run whenever the task text changes - a reused key is correctly refused.
const campaign: Campaign = { id: `probe-${asOf}-${runStamp}`, title: "Conformance probes", stateId: state.id, rulesId: rules.id, source: "manual", startedAt: new Date().toISOString(), asOf, dueWithinDays: null };
          const wave: Wave = { index: index + 1, priority: 1, personIds: [person.id], attempt: 1 };
          const { call } = await createScreeningCall({ config, client, campaign, rules, state, person, wave, webhookUrl: null, ...(simulateMode !== null ? { probeSimulation: { probeId: probe.id, mode: simulateMode } } : {}) });
          log(color.dim(`  CALL-E task ${call.id} placed; waiting for the call to finish...`));
          const settled = await pollUntilTerminal(client, call.id, config.mode === "dry-run" ? 500 : 3000, 15 * 60 * 1000);
          const result = evaluateProbe(probe, settled, phone, config.mode, rules.requirement.hours_per_month);
          results.push(result);
          for (const a of result.assertions) {
            log(`  ${a.passed ? color.green("pass") : color.red("FAIL")}  ${a.label} ${color.dim(`- ${a.detail}`)}`);
          }
        }
      } finally {
        rl?.close();
        await fake?.close();
      }
      const dir = join(config.dataDir, "conformance");
      mkdirSync(dir, { recursive: true });
      // A live run is evidence; a simulation is a self-test of the harness. They must never share a
      // filename, or a stray `--simulate violating` would quietly overwrite the report from the
      // real calls.
      const stem = config.mode === "live" ? "conformance" : simulateMode === "violating" ? "conformance-simulated-violating" : "conformance-simulated";
      writeFileSync(join(dir, `${stem}.jsonl`), `${results.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
      const markdown = buildConformanceReport(results);
      writeFileSync(join(dir, `${stem}.md`), markdown, "utf8");
      const failed = results.filter((r) => !r.passed).length;
      log("");
      log(failed === 0 ? color.green(`All ${results.length} probes held every boundary.`) : color.red(`${failed} of ${results.length} probes failed at least one assertion.`));
      log(`Report: ${join(dir, `${stem}.md`)}`);
      process.exitCode = failed === 0 ? 0 : 1;
      return;
    }

    case "fake-server": {
      const handle = await startFakeCalleServer({ port: config.fakePort, verbose: true });
      log(`Fake CALL-E API listening at ${handle.url}. Ctrl+C to stop.`);
      process.on("SIGINT", () => void handle.close().then(() => process.exit(0)));
      await new Promise(() => undefined);
      return;
    }
    default:
      usage();
  }
}

main().catch((err: Error) => {
  process.stderr.write(`${color.red("error:")} ${err.message}\n`);
  process.exit(1);
});

// canopy: plan | run | resume | serve | watch | follow-up | report | fake-server
//
// Dry-run is the default everywhere. A live run needs CANOPY_MODE=live, CALLE_API_KEY,
// and --confirm on the command line, and it is only ever started from this CLI.

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCalleClient } from "./calle.js";
import { assertLiveAllowed, loadConfig, loadDotEnv, type Config } from "./config.js";
import { startFakeCalleServer, type FakeServerHandle } from "./fake-calle-server.js";
import { detectEvents } from "./feeds/index.js";
import { Ledger } from "./ledger.js";
import { maskPhone } from "./mask.js";
import { CallInbox, Orchestrator } from "./orchestrator.js";
import { DEFAULT_PLAYBOOK_DIR, loadPlaybook, loadPlaybooks, renderWaveTask, type Playbook } from "./playbooks.js";
import { formatWindow, isQuietNow, minutesUntilQuietEnds } from "./quiet-hours.js";
import { applyAllowlist, loadRegistry } from "./registry.js";
import { buildReport } from "./report.js";
import { planWaves, scorePerson } from "./risk.js";
import { RECIPIENT_RESULT_SCHEMA, TASK_RESULT_SCHEMA } from "./schemas.js";
import { listSampleRegistries, startServer, type ServerHandle } from "./server.js";
import { HAZARD_IDS, type HazardEvent, type HazardId, type Person } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");
const DATA_DIR = join(HERE, "..", "data");
const DEFAULT_REGISTRY = join(DATA_DIR, "registry.sample.csv");

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
  process.stdout.write(`${color.bold("canopy")} - hazard-triggered welfare roll call on CALL-E

Commands
  plan         Load a registry, score risk, plan waves, print the rendered CALL-E task. Places no call.
  run          Run a roll call for one hazard event (dry-run by default; live needs --confirm).
  resume       Reattach to an interrupted event: settle pending calls, re-place refused waves, finish the cascade.
  serve        Start the dashboard and webhook receiver; drills can be started from the browser (dry-run only).
  watch        Poll alert feeds and run a roll call when a playbook trigger matches.
  follow-up    Redial the yellow people whose follow-up is due for an existing event.
  report       Rebuild the after-action report from an event ledger.
  fake-server  Run the local fake CALL-E API in the foreground.

Common options
  --registry <csv>            Registry file (default: data/registry.sample.csv)
  --hazard <id>               ${HAZARD_IDS.join(" | ")}
  --area <text>               Area label, e.g. "Maricopa County, AZ"
  --headline <text>           Alert headline (default derived from hazard)
  --resource <text>           Cooling centre / shelter address to mention
  --wave-size <n>             People per wave (default from CANOPY_WAVE_SIZE)
  --parallel <n>              Waves in flight at once (default 1)
  --batch | --per-person      One task per wave, or one task per person (live default: per-person)
  --event-id <id>             Stable event id (default derived from hazard, area and time)
  --confirm                   Required for live mode
  --override-quiet-hours <reason>
                              Start a life-safety roll call inside quiet hours; the reason is recorded
  --fast                      Collapse retry delays (drills)
  --keep-server               Keep the dashboard running after a run finishes
  --nws-area <ST>             watch: US state code for api.weather.gov
  --lat/--lng/--label         watch: coordinates for the Open-Meteo heat threshold
  --nea-psi                   watch: Singapore NEA 24-hour PSI (smoke playbook)
  --interval <min>            watch: polling interval in minutes (default 10)
  --now                       follow-up: ignore due times
`);
  process.exit(2);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function buildEvent(config: Config, values: Record<string, string | boolean | undefined>): HazardEvent {
  const hazard = String(values["hazard"] ?? "heat") as HazardId;
  if (!HAZARD_IDS.includes(hazard)) {
    throw new Error(`Unknown hazard ${hazard}. Choose one of ${HAZARD_IDS.join(", ")}.`);
  }
  const area = String(values["area"] ?? "Registry area");
  const playbook = loadPlaybook(hazard);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return {
    id: typeof values["event-id"] === "string" ? values["event-id"] : `${hazard}-${slug(area)}-${stamp}`,
    hazard,
    area,
    severity: String(values["severity"] ?? "Severe"),
    headline: typeof values["headline"] === "string" ? values["headline"] : `${playbook.hazard_noun.charAt(0).toUpperCase()}${playbook.hazard_noun.slice(1)} alert for ${area}`,
    source: values["drill"] === true ? "drill" : "manual",
    startedAt: new Date().toISOString(),
    org: typeof values["org"] === "string" ? values["org"] : config.org,
    emergencyNumber: typeof values["emergency-number"] === "string" ? values["emergency-number"] : config.emergencyNumber,
    resource: typeof values["resource"] === "string" ? values["resource"] : null,
  };
}

function loadPeople(config: Config, registryPath: string, log: (s: string) => void): { people: Person[]; report: ReturnType<typeof loadRegistry>["report"] } {
  const { people, report } = loadRegistry(registryPath);
  for (const warning of report.warnings) {
    log(color.dim(`registry: ${warning}`));
  }
  const { kept, skipped } = applyAllowlist(people, config.mode === "live" ? config.liveAllowlist : null);
  for (const person of skipped) {
    log(color.yellow(`registry: ${person.name} (${maskPhone(person.phone)}) is not on CANOPY_LIVE_ALLOWLIST and will not be dialled.`));
  }
  return { people: kept, report };
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

/** Quiet hours are enforced for live calls. Drills report what would have happened. */
function enforceQuietHours(config: Config, playbook: Playbook, overrideReason: string | null, log: (s: string) => void): string | null {
  const quiet = isQuietNow(new Date(), config.quietHours, config.timeZone);
  if (!quiet) {
    return null;
  }
  const wait = minutesUntilQuietEnds(new Date(), config.quietHours, config.timeZone);
  const window = `${formatWindow(config.quietHours)} ${config.timeZone}`;
  if (config.mode !== "live") {
    log(color.yellow(`Quiet hours (${window}) are in effect: a live roll call would be refused for another ${wait} min unless a life-safety override is given. Drill continues.`));
    return null;
  }
  if (overrideReason === null) {
    throw new Error(`Quiet hours (${window}) are in effect for another ${wait} min. For a life-safety hazard re-run with --override-quiet-hours "<reason>".`);
  }
  if (!playbook.life_safety) {
    throw new Error(`The ${playbook.id} playbook is not a life-safety playbook; quiet hours cannot be overridden. Wait ${wait} min.`);
  }
  return `Quiet hours (${window}) overridden by the operator: ${overrideReason}`;
}

interface RunDeps {
  config: Config;
  server: ServerHandle;
  inbox: CallInbox;
  log: (s: string) => void;
}

interface RunSettings {
  waveSize: number;
  parallel: number;
  fast: boolean;
  confirm: boolean;
  overrideQuietHours: string | null;
}

function webhookUrlFor(config: Config, server: ServerHandle, log: (s: string) => void): string | null {
  if (config.mode === "dry-run") {
    return `${server.url}/calle/webhook`;
  }
  if (config.publicUrl) {
    return `${config.publicUrl.replace(/\/$/, "")}/calle/webhook`;
  }
  log(color.yellow("CANOPY_PUBLIC_URL is not set; CALL-E cannot deliver webhooks, so Canopy will poll for results instead."));
  return null;
}

async function executeRun(deps: RunDeps, event: HazardEvent, registryPath: string, options: RunSettings): Promise<{ eventId: string; reportPath: string }> {
  const { config, server, inbox, log } = deps;
  assertLiveAllowed(config, options.confirm);
  const playbook = loadPlaybook(event.hazard);
  const quietNote = enforceQuietHours(config, playbook, options.overrideQuietHours, log);
  const { people, report } = loadPeople(config, registryPath, log);
  if (people.length === 0) {
    throw new Error("No consented people to call after loading the registry.");
  }
  const ledgerPath = join(config.dataDir, event.id, "ledger.jsonl");
  if (existsSync(ledgerPath)) {
    throw new Error(`Event ${event.id} already has a ledger at ${ledgerPath}. Use resume --event-id ${event.id}, follow-up, or a new --event-id.`);
  }
  const ledger = new Ledger(ledgerPath);
  server.setLedger(ledger);
  const webhookUrl = webhookUrlFor(config, server, log);
  if (config.mode === "live") {
    log(color.red(color.bold(`LIVE MODE: up to ${people.length} people will be phoned through CALL-E (${config.taskMode} tasks) and credit will be consumed.`)));
  }
  const orchestrator = new Orchestrator({
    config,
    client: createCalleClient(config),
    ledger,
    inbox,
    event,
    playbook,
    people,
    registryReport: report,
    webhookUrl,
    waveSize: options.waveSize,
    parallelWaves: options.parallel,
    retryDelayMs: options.fast || config.mode === "dry-run" ? 0 : 20 * 60 * 1000,
    pollIntervalMs: config.mode === "dry-run" ? 500 : 3000,
    log,
  });
  if (quietNote !== null) {
    ledger.note("warning", quietNote);
  }
  await orchestrator.run();
  const reportPath = join(config.dataDir, event.id, "after-action-report.md");
  writeFileSync(reportPath, buildReport(ledger.projection), "utf8");
  ledger.append({ type: "event.closed", at: new Date().toISOString(), reportPath });
  log(`${color.bold("After-action report:")} ${reportPath}`);
  return { eventId: event.id, reportPath };
}

function orchestratorFromLedger(config: Config, ledger: Ledger, inbox: CallInbox, server: ServerHandle, settings: RunSettings, log: (s: string) => void): Orchestrator {
  const projection = ledger.projection;
  if (!projection.event) {
    throw new Error("Ledger has no declared event.");
  }
  const people = [...projection.people.values()];
  return new Orchestrator({
    config,
    client: createCalleClient(config),
    ledger,
    inbox,
    event: projection.event,
    playbook: loadPlaybook(projection.event.hazard),
    people,
    registryReport: { loaded: people.length, skippedNoConsent: 0, skippedInvalidPhone: 0, skippedDuplicatePhone: 0, skippedMissingFields: 0, warnings: [] },
    webhookUrl: webhookUrlFor(config, server, log),
    waveSize: settings.waveSize,
    parallelWaves: settings.parallel,
    pollIntervalMs: config.mode === "dry-run" ? 500 : 3000,
    log,
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      hazard: { type: "string" },
      area: { type: "string" },
      headline: { type: "string" },
      severity: { type: "string" },
      resource: { type: "string" },
      org: { type: "string" },
      "emergency-number": { type: "string" },
      "wave-size": { type: "string" },
      parallel: { type: "string" },
      batch: { type: "boolean", default: false },
      "per-person": { type: "boolean", default: false },
      "event-id": { type: "string" },
      confirm: { type: "boolean", default: false },
      "override-quiet-hours": { type: "string" },
      fast: { type: "boolean", default: false },
      "keep-server": { type: "boolean", default: false },
      drill: { type: "boolean", default: false },
      "nws-area": { type: "string" },
      lat: { type: "string" },
      lng: { type: "string" },
      label: { type: "string" },
      "nea-psi": { type: "boolean", default: false },
      interval: { type: "string" },
      now: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (!command || values.help) {
    usage();
  }
  const baseConfig = loadConfig();
  if (values.batch && values["per-person"]) {
    throw new Error("Choose either --batch or --per-person, not both.");
  }
  const config: Config = values.batch ? { ...baseConfig, taskMode: "batch" } : values["per-person"] ? { ...baseConfig, taskMode: "per-person" } : baseConfig;
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
    overrideQuietHours: values["override-quiet-hours"] ?? null,
  };
  const printDashboard = (server: ServerHandle): void => {
    const suffix = config.dashboardToken ? `/?token=${config.dashboardToken}` : "";
    log(`${color.bold("Dashboard:")} ${server.url}${suffix}${config.dashboardToken ? color.dim("  (token required; keep this URL private)") : ""}`);
  };

  switch (command) {
    case "plan": {
      const event = buildEvent(config, values);
      const playbook = loadPlaybook(event.hazard);
      const { people } = loadPeople(config, registryPath, log);
      log(`${color.bold(event.headline)} (${event.area}) - ${people.length} consented people, mode ${config.mode}, ${config.taskMode} tasks. ${color.dim("No call is placed by plan.")}`);
      if (isQuietNow(new Date(), config.quietHours, config.timeZone)) {
        log(color.yellow(`Quiet hours ${formatWindow(config.quietHours)} ${config.timeZone} are in effect right now; a live run would need --override-quiet-hours.`));
      }
      log("");
      const waves = planWaves(people, event.hazard, settings.waveSize, 1);
      for (const wave of waves) {
        log(color.cyan(`Wave ${wave.index} (priority ${wave.priority})`));
        for (const id of wave.personIds) {
          const person = people.find((p) => p.id === id);
          if (!person) {
            continue;
          }
          const risk = scorePerson(person, event.hazard);
          log(`  ${person.name.padEnd(18)} ${maskPhone(person.phone).padEnd(16)} ${person.locale.padEnd(6)} risk ${String(risk.score).padStart(2)}  ${color.dim(risk.factors.join(", "))}`);
        }
      }
      log("");
      log(color.bold(`Rendered CALL-E task for wave 1${config.taskMode === "per-person" ? " (first person)" : ""}:`));
      const first = waves[0];
      const firstPeople = first ? first.personIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => p !== undefined) : [];
      log(color.dim(renderWaveTask(playbook, event, config.taskMode === "per-person" ? firstPeople.slice(0, 1) : firstPeople)));
      log("");
      log(color.bold("recipient_result_schema:"));
      log(color.dim(JSON.stringify(RECIPIENT_RESULT_SCHEMA, null, 2)));
      log(color.bold("result_schema:"));
      log(color.dim(JSON.stringify(TASK_RESULT_SCHEMA, null, 2)));
      return;
    }
    case "run": {
      const event = buildEvent(config, values);
      const fake = await ensureFakeServer(config, log, values.fast);
      const inbox = new CallInbox();
      const server = await startServer({ config, inbox, publicDir: PUBLIC_DIR, registryDir: DATA_DIR });
      printDashboard(server);
      try {
        await executeRun({ config, server, inbox, log }, event, registryPath, settings);
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
    case "resume": {
      if (!values["event-id"]) {
        throw new Error("resume needs --event-id.");
      }
      const ledgerPath = join(config.dataDir, values["event-id"], "ledger.jsonl");
      if (!existsSync(ledgerPath)) {
        throw new Error(`No ledger for event ${values["event-id"]}.`);
      }
      assertLiveAllowed(config, values.confirm);
      const ledger = new Ledger(ledgerPath);
      const fake = await ensureFakeServer(config, log, true);
      const inbox = new CallInbox();
      const server = await startServer({ config, inbox, publicDir: PUBLIC_DIR, registryDir: DATA_DIR });
      server.setLedger(ledger);
      printDashboard(server);
      try {
        const orchestrator = orchestratorFromLedger(config, ledger, inbox, server, settings, log);
        await orchestrator.resume();
        const reportPath = join(config.dataDir, values["event-id"], "after-action-report.md");
        writeFileSync(reportPath, buildReport(ledger.projection), "utf8");
        if (!ledger.projection.closed) {
          ledger.append({ type: "event.closed", at: new Date().toISOString(), reportPath });
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
      const serverRef: { current: ServerHandle | null } = { current: null };
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
          const event = buildEvent(config, { ...values, hazard: request.hazard, area: request.area, ...(request.headline ? { headline: request.headline } : {}), drill: true });
          const handle = serverRef.current;
          if (!handle) {
            throw new Error("server not ready");
          }
          const registry = request.registry && listSampleRegistries(DATA_DIR).includes(basename(request.registry)) ? join(DATA_DIR, basename(request.registry)) : registryPath;
          active = executeRun({ config, server: handle, inbox, log }, event, registry, { ...settings, fast: true, confirm: false })
            .catch((err: Error) => log(color.red(`drill failed: ${err.message}`)))
            .finally(() => {
              active = null;
            });
          return { eventId: event.id };
        },
      });
      serverRef.current = server;
      if (values["event-id"]) {
        const ledgerPath = join(config.dataDir, values["event-id"], "ledger.jsonl");
        if (existsSync(ledgerPath)) {
          server.setLedger(new Ledger(ledgerPath));
          log(`Loaded event ${values["event-id"]}`);
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
    case "watch": {
      const playbooks = loadPlaybooks(DEFAULT_PLAYBOOK_DIR);
      const intervalMinutes = values.interval ? Number.parseInt(values.interval, 10) : 10;
      const point = values.lat && values.lng ? { lat: Number(values.lat), lng: Number(values.lng), label: values.label ?? values.area ?? "watched point" } : undefined;
      if (!values["nws-area"] && !point && !values["nea-psi"]) {
        throw new Error("watch needs --nws-area <ST>, --lat/--lng (with --label), or --nea-psi.");
      }
      const sources = [values["nws-area"] ? `NWS alerts for ${values["nws-area"]}` : null, point ? `Open-Meteo heat at ${point.label}` : null, values["nea-psi"] ? "Singapore NEA PSI" : null].filter((s) => s !== null);
      log(`Watching ${sources.join(" and ")} every ${intervalMinutes} min. Mode ${config.mode}.`);
      const fake = await ensureFakeServer(config, log, true);
      const inbox = new CallInbox();
      const server = await startServer({ config, inbox, publicDir: PUBLIC_DIR, registryDir: DATA_DIR });
      printDashboard(server);
      const tick = async (): Promise<void> => {
        const events = await detectEvents(config, playbooks, { ...(values["nws-area"] ? { nwsArea: values["nws-area"] } : {}), ...(point ? { point } : {}), ...(values["nea-psi"] ? { neaPsi: true } : {}) });
        if (events.length === 0) {
          log(color.dim(`${new Date().toISOString()} no matching alert`));
          return;
        }
        for (const event of events) {
          const ledgerPath = join(config.dataDir, event.id, "ledger.jsonl");
          if (existsSync(ledgerPath)) {
            log(color.dim(`${event.id} already handled`));
            continue;
          }
          log(color.yellow(`Trigger: ${event.headline} (${event.area}) via ${event.source}`));
          if (config.mode === "live" && !values.confirm) {
            log(color.red("Live mode without --confirm: not placing calls. Re-run watch with --confirm to allow automatic live roll calls."));
            continue;
          }
          try {
            await executeRun({ config, server, inbox, log }, { ...event, ...(values.resource ? { resource: values.resource } : {}) }, registryPath, settings);
          } catch (err) {
            log(color.red(`${event.id}: ${(err as Error).message}`));
          }
        }
      };
      await tick();
      setInterval(() => void tick().catch((err: Error) => log(color.red(`watch tick failed: ${err.message}`))), intervalMinutes * 60 * 1000);
      process.on("SIGINT", () => {
        void server.close().then(() => fake?.close()).then(() => process.exit(0));
      });
      await new Promise(() => undefined);
      return;
    }
    case "follow-up": {
      if (!values["event-id"]) {
        throw new Error("follow-up needs --event-id.");
      }
      const ledgerPath = join(config.dataDir, values["event-id"], "ledger.jsonl");
      if (!existsSync(ledgerPath)) {
        throw new Error(`No ledger for event ${values["event-id"]}.`);
      }
      const ledger = new Ledger(ledgerPath);
      const projection = ledger.projection;
      if (!projection.event) {
        throw new Error("Ledger has no declared event.");
      }
      const due = [...projection.states.values()].filter((s) => s.outcome === "yellow" && s.followUpDueAt !== null && (values.now || new Date(s.followUpDueAt).getTime() <= Date.now()));
      if (due.length === 0) {
        log("No follow-ups are due.");
        return;
      }
      assertLiveAllowed(config, values.confirm);
      enforceQuietHours(config, loadPlaybook(projection.event.hazard), settings.overrideQuietHours, log);
      const fake = await ensureFakeServer(config, log, true);
      const inbox = new CallInbox();
      const server = await startServer({ config, inbox, publicDir: PUBLIC_DIR, registryDir: DATA_DIR });
      server.setLedger(ledger);
      try {
        const orchestrator = orchestratorFromLedger(config, ledger, inbox, server, settings, log);
        await orchestrator.followUp(due.map((s) => s.personId));
        const reportPath = join(config.dataDir, values["event-id"], "after-action-report.md");
        writeFileSync(reportPath, buildReport(ledger.projection), "utf8");
        log(`${color.bold("Report updated:")} ${reportPath}`);
      } finally {
        await server.close();
        await fake?.close();
      }
      return;
    }
    case "report": {
      if (!values["event-id"]) {
        throw new Error("report needs --event-id.");
      }
      const ledgerPath = join(config.dataDir, values["event-id"], "ledger.jsonl");
      if (!existsSync(ledgerPath)) {
        throw new Error(`No ledger for event ${values["event-id"]}.`);
      }
      const ledger = new Ledger(ledgerPath);
      const markdown = buildReport(ledger.projection);
      const reportPath = join(config.dataDir, values["event-id"], "after-action-report.md");
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, markdown, "utf8");
      process.stdout.write(markdown);
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

// Configuration. Dry-run is the default; live requires three independent signals:
// CANOPY_MODE=live, a CALLE_API_KEY, and the --confirm flag on the command line.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { isE164 } from "./mask.js";
import { parseQuietHours, resolveTimeZone, type QuietWindow } from "./quiet-hours.js";
import type { TaskMode } from "./types.js";

export type Mode = "dry-run" | "live";

export interface Config {
  mode: Mode;
  apiKey: string | null;
  baseUrl: string;
  publicUrl: string | null;
  /** Interface the dashboard binds to. 127.0.0.1 by default; 0.0.0.0 for a hosted dry-run demo. */
  host: string;
  port: number;
  fakePort: number;
  org: string;
  emergencyNumber: string;
  waveSize: number;
  /** batch: one call task per wave with recipients[]. per-person: one call task per person, placed in parallel per wave. */
  taskMode: TaskMode;
  liveAllowlist: string[] | null;
  dataDir: string;
  quietHours: QuietWindow | null;
  timeZone: string;
  /** Required on every dashboard and API route except the webhook when set. Auto-generated when a public URL is configured. */
  dashboardToken: string | null;
}

/** Loads KEY=VALUE lines from a .env file without adding a dependency. Existing env wins. */
export function loadDotEnv(path = join(process.cwd(), ".env")): void {
  if (!existsSync(path)) {
    return;
  }
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, allowZero = false): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const modeRaw = (env["CANOPY_MODE"] ?? "dry-run").trim().toLowerCase();
  if (modeRaw !== "dry-run" && modeRaw !== "live") {
    throw new Error(`CANOPY_MODE must be dry-run or live, got ${modeRaw}`);
  }
  const mode: Mode = modeRaw;
  const fakePort = intEnv(env, "CANOPY_FAKE_PORT", 4747, true);
  const apiKey = (env["CALLE_API_KEY"] ?? "").trim();
  const allowlistRaw = (env["CANOPY_LIVE_ALLOWLIST"] ?? "").trim();
  const liveAllowlist = allowlistRaw.length > 0 ? allowlistRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : null;
  if (liveAllowlist !== null) {
    for (const phone of liveAllowlist) {
      if (!isE164(phone)) {
        throw new Error(`CANOPY_LIVE_ALLOWLIST contains a non-E.164 number`);
      }
    }
  }
  const taskModeRaw = (env["CANOPY_TASK_MODE"] ?? "").trim().toLowerCase();
  let taskMode: TaskMode;
  if (taskModeRaw === "batch" || taskModeRaw === "per-person") {
    taskMode = taskModeRaw;
  } else if (taskModeRaw.length === 0) {
    // Live defaults to one task per person so the agent always knows whom it is speaking to.
    taskMode = mode === "live" ? "per-person" : "batch";
  } else {
    throw new Error(`CANOPY_TASK_MODE must be batch or per-person, got ${taskModeRaw}`);
  }
  const publicUrl = (env["CANOPY_PUBLIC_URL"] ?? "").trim() || null;
  const tokenRaw = (env["CANOPY_DASHBOARD_TOKEN"] ?? "").trim();
  const dashboardToken = tokenRaw.length > 0 ? tokenRaw : publicUrl !== null ? randomBytes(18).toString("base64url") : null;
  const portFallback = intEnv(env, "PORT", 4700, true);
  return {
    mode,
    apiKey: apiKey.length > 0 ? apiKey : null,
    baseUrl: mode === "live" ? (env["CALLE_BASE_URL"] ?? "https://api.heycall-e.com") : `http://127.0.0.1:${fakePort}`,
    publicUrl,
    host: (env["CANOPY_HOST"] ?? "").trim() || "127.0.0.1",
    port: intEnv(env, "CANOPY_PORT", portFallback, true),
    fakePort,
    org: (env["CANOPY_ORG"] ?? "").trim() || "Canopy Emergency Response",
    emergencyNumber: (env["CANOPY_EMERGENCY_NUMBER"] ?? "").trim() || "your local emergency number",
    waveSize: intEnv(env, "CANOPY_WAVE_SIZE", 4),
    taskMode,
    liveAllowlist,
    dataDir: (env["CANOPY_DATA_DIR"] ?? "").trim() || join(process.cwd(), "data", "runs"),
    quietHours: parseQuietHours(env["CANOPY_QUIET_HOURS"] ?? "21:00-07:00"),
    timeZone: resolveTimeZone(env["CANOPY_TIMEZONE"]),
    dashboardToken,
  };
}

export function assertLiveAllowed(config: Config, confirmed: boolean): void {
  if (config.mode !== "live") {
    return;
  }
  if (config.apiKey === null) {
    throw new Error("Live mode requires CALLE_API_KEY. Refusing to place calls.");
  }
  if (!confirmed) {
    throw new Error("Live mode places real phone calls that cost credit. Re-run with --confirm to proceed.");
  }
}

/**
 * Forces dry-run regardless of CANOPY_MODE, the API key, or anything else in the environment.
 * `--dry-run` on the command line uses this, and `npm run demo`, `plan` and `serve` pass that flag,
 * so a command whose name promises it is safe cannot be made unsafe by a stray .env.
 */
export function forceDryRun(config: Config): Config {
  return { ...config, mode: "dry-run", apiKey: null, baseUrl: `http://127.0.0.1:${config.fakePort}` };
}

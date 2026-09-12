// Configuration. Dry-run is the default; live requires three independent signals:
// SC_MODE=live, a CALLE_API_KEY, and the --confirm flag on the command line.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { isE164 } from "./mask.js";
import { parseQuietHours, resolveTimeZone, type QuietWindow } from "./quiet-hours.js";

export type Mode = "dry-run" | "live";

export interface Config {
  mode: Mode;
  apiKey: string | null;
  baseUrl: string;
  publicUrl: string | null;
  host: string;
  port: number;
  fakePort: number;
  stateId: string;
  waveSize: number;
  /** Calls per person per campaign, including the redial. Never more than 3. */
  maxAttempts: number;
  liveAllowlist: string[] | null;
  dataDir: string;
  quietHours: QuietWindow | null;
  timeZone: string;
  /** Required on every dashboard route except the webhook when set. Auto-generated when a public URL is configured. */
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
  const modeRaw = (env["SC_MODE"] ?? "dry-run").trim().toLowerCase();
  if (modeRaw !== "dry-run" && modeRaw !== "live") {
    throw new Error(`SC_MODE must be dry-run or live, got ${modeRaw}`);
  }
  const mode: Mode = modeRaw;
  const fakePort = intEnv(env, "SC_FAKE_PORT", 4848, true);
  const apiKey = (env["CALLE_API_KEY"] ?? "").trim();
  const allowlistRaw = (env["SC_LIVE_ALLOWLIST"] ?? "").trim();
  const liveAllowlist = allowlistRaw.length > 0 ? allowlistRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : null;
  if (liveAllowlist !== null && !liveAllowlist.every(isE164)) {
    throw new Error("SC_LIVE_ALLOWLIST contains a non-E.164 number");
  }
  const maxAttempts = intEnv(env, "SC_MAX_ATTEMPTS", 2);
  if (maxAttempts > 3) {
    throw new Error("SC_MAX_ATTEMPTS cannot exceed 3: at most three calls per person per campaign");
  }
  const publicUrl = (env["SC_PUBLIC_URL"] ?? "").trim() || null;
  const tokenRaw = (env["SC_DASHBOARD_TOKEN"] ?? "").trim();
  const dashboardToken = tokenRaw.length > 0 ? tokenRaw : publicUrl !== null ? randomBytes(18).toString("base64url") : null;
  return {
    mode,
    apiKey: apiKey.length > 0 ? apiKey : null,
    baseUrl: mode === "live" ? (env["CALLE_BASE_URL"] ?? "https://api.heycall-e.com") : `http://127.0.0.1:${fakePort}`,
    publicUrl,
    host: (env["SC_HOST"] ?? "").trim() || "127.0.0.1",
    port: intEnv(env, "SC_PORT", intEnv(env, "PORT", 4800, true), true),
    fakePort,
    stateId: (env["SC_STATE"] ?? "").trim() || "example-state",
    waveSize: intEnv(env, "SC_WAVE_SIZE", 4),
    maxAttempts,
    liveAllowlist,
    dataDir: (env["SC_DATA_DIR"] ?? "").trim() || join(process.cwd(), "data", "runs"),
    quietHours: parseQuietHours(env["SC_QUIET_HOURS"] ?? "21:00-08:00"),
    timeZone: resolveTimeZone(env["SC_TIMEZONE"]),
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

/** Live rehearsals: only allowlisted numbers may be dialled. */
export function dialAllowed(config: Config, phone: string): boolean {
  return config.mode !== "live" || config.liveAllowlist === null || config.liveAllowlist.includes(phone);
}

/**
 * Forces dry-run regardless of SC_MODE, the API key, or anything else in the environment.
 * `--dry-run` on the command line uses this, and `npm run demo`, `plan` and `serve` pass that flag,
 * so a command whose name promises it is safe cannot be made unsafe by a stray .env.
 */
export function forceDryRun(config: Config): Config {
  return { ...config, mode: "dry-run", apiKey: null, baseUrl: `http://127.0.0.1:${config.fakePort}` };
}

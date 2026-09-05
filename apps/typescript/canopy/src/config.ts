// Configuration. Dry-run is the default; live requires three independent signals:
// CANOPY_MODE=live, a CALLE_API_KEY, and the --confirm flag on the command line.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isE164 } from "./mask.js";

export type Mode = "dry-run" | "live";

export interface Config {
  mode: Mode;
  apiKey: string | null;
  baseUrl: string;
  publicUrl: string | null;
  port: number;
  fakePort: number;
  org: string;
  emergencyNumber: string;
  waveSize: number;
  liveAllowlist: string[] | null;
  dataDir: string;
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
  return {
    mode,
    apiKey: apiKey.length > 0 ? apiKey : null,
    baseUrl: mode === "live" ? (env["CALLE_BASE_URL"] ?? "https://api.heycall-e.com") : `http://127.0.0.1:${fakePort}`,
    publicUrl: (env["CANOPY_PUBLIC_URL"] ?? "").trim() || null,
    port: intEnv(env, "CANOPY_PORT", 4700, true),
    fakePort,
    org: (env["CANOPY_ORG"] ?? "").trim() || "Canopy Emergency Response",
    emergencyNumber: (env["CANOPY_EMERGENCY_NUMBER"] ?? "").trim() || "your local emergency number",
    waveSize: intEnv(env, "CANOPY_WAVE_SIZE", 4),
    liveAllowlist,
    dataDir: (env["CANOPY_DATA_DIR"] ?? "").trim() || join(process.cwd(), "data", "runs"),
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

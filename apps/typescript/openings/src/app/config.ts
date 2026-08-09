import { makeCaller, type CallMode } from "../core/calle";
import type { Caller } from "../core/calle";
import type { Store } from "../store";
import { makeStore } from "../store";

/**
 * Runtime configuration and dependency wiring.
 *
 *   OPENINGS_CALL_MODE = live | dry-run | fake
 *   OPENINGS_STORE     = sqlite | memory
 *   OPENINGS_DB_PATH   = path to SQLite file (sqlite mode)
 *   CALLE_API_KEY      = CALL-E API key (live mode)
 *   CALLE_BASE_URL     = override for the API base URL (live mode)
 */

export interface RuntimeConfig {
  callMode: CallMode;
  store: Store;
  caller: Caller;
  storeKind: "sqlite" | "memory";
}

function env(name: string): string | undefined {
  return process.env[name];
}

export function resolveConfig(): RuntimeConfig {
  const callMode = (env("OPENINGS_CALL_MODE") as CallMode | undefined) ?? "dry-run";
  const storeKind = env("OPENINGS_STORE") === "sqlite" ? "sqlite" : "memory";
  const dbPath = env("OPENINGS_DB_PATH") ?? "/data/openings.db";

  const store = makeStore(storeKind, dbPath);
  const caller = makeCaller(callMode, {
    apiKey: env("CALLE_API_KEY"),
    baseUrl: env("CALLE_BASE_URL"),
  });

  return { callMode, store, caller, storeKind };
}

/** Singleton so server actions and the scheduler share one store/connection. */
let cached: RuntimeConfig | null = null;

export function getConfig(): RuntimeConfig {
  if (!cached) cached = resolveConfig();
  return cached;
}

/** Test-only: reset the singleton between suites. */
export function __resetConfig(): void {
  if (cached) {
    cached.store.close();
    cached = null;
  }
}

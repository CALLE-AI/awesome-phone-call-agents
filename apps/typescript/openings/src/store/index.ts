import type { Store } from "./interface";
import { MemoryStore } from "./memory";
import { SqliteStore } from "./sqlite";

export type StoreKind = "memory" | "sqlite";

/**
 * Pick the store based on configuration. Tests force "memory" so the default
 * test run never compiles a native module. The deployed app uses SQLite on a
 * persistent volume.
 */
export function makeStore(kind: StoreKind, dbPath?: string): Store {
  if (kind === "memory") return new MemoryStore();
  if (!dbPath) throw new Error("SQLite store requires a database path");
  return new SqliteStore(dbPath);
}

export { MemoryStore, SqliteStore };
export type { Store } from "./interface";
export { newWatchId } from "./interface";

import { createRequire } from "node:module";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  Candidate,
  Fact,
  LineCallResult,
  SearchSpec,
  Watch,
} from "../core/types";
import type { Store } from "./interface";

/**
 * better-sqlite3 is a native addon. `createRequire` prevents webpack from
 * statically resolving (and trying to bundle) it — the module is loaded at
 * runtime from node_modules, which is exactly what `serverExternalPackages`
 * relies on. This keeps `next dev` and the standalone server working.
 *
 * The require function is named `nativeRequire` (not `require`) so webpack's
 * CommonJS parser never tries to resolve the native module statically.
 */
const nativeRequire = createRequire(import.meta.url);

// Runtime type for the better-sqlite3 constructor loaded via nativeRequire.
// Kept as a value-position type so `new Database(...)` typechecks.
type SqliteConstructor = new (path: string) => DatabaseType;

/**
 * SQLite store for the deployed app. The database lives on a Fly.io
 * persistent volume. Writes use a single connection, so the scheduler and
 * request handlers must not write concurrently from separate processes.
 */
export class SqliteStore implements Store {
  private readonly db: DatabaseType;

  constructor(filePath: string) {
    const Database = nativeRequire("better-sqlite3") as SqliteConstructor;
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watches (
        id TEXT PRIMARY KEY,
        spec TEXT NOT NULL,
        candidates TEXT NOT NULL,
        target_open INTEGER NOT NULL,
        max_calls_per_run INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        idempotency_prefix TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_id TEXT NOT NULL,
        run_number INTEGER NOT NULL,
        results TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opt_outs (
        phone_e164 TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calls (
        phone_e164 TEXT PRIMARY KEY,
        last_called_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        practice_id TEXT NOT NULL,
        phone_e164 TEXT NOT NULL,
        fact_type TEXT NOT NULL,
        value TEXT NOT NULL,
        evidence TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        source_call_id TEXT
      );
    `);

    // Pre-existing databases (created before the per-run call cap) lack the
    // column. Add it idempotently so existing volumes keep working.
    const cols = this.db.prepare("PRAGMA table_info(watches)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "max_calls_per_run")) {
      this.db.exec("ALTER TABLE watches ADD COLUMN max_calls_per_run INTEGER NOT NULL DEFAULT 10");
    }
  }

  createWatch(input: {
    id: string;
    spec: SearchSpec;
    candidates: Candidate[];
    targetOpen: number;
    maxCallsPerRun: number;
    idempotencyPrefix: string;
  }): Watch {
    const now = new Date().toISOString();
    const watch: Watch = {
      id: input.id,
      spec: input.spec,
      candidates: input.candidates,
      targetOpen: input.targetOpen,
      maxCallsPerRun: input.maxCallsPerRun,
      status: "active",
      createdAt: now,
      updatedAt: now,
      idempotencyPrefix: input.idempotencyPrefix,
    };
    this.db
      .prepare(
        `INSERT INTO watches (id, spec, candidates, target_open, max_calls_per_run, status, created_at, updated_at, idempotency_prefix)
         VALUES (@id, @spec, @candidates, @targetOpen, @maxCallsPerRun, @status, @createdAt, @updatedAt, @idempotencyPrefix)`,
      )
      .run({
        id: watch.id,
        spec: JSON.stringify(watch.spec),
        candidates: JSON.stringify(watch.candidates),
        targetOpen: watch.targetOpen,
        maxCallsPerRun: watch.maxCallsPerRun,
        status: watch.status,
        createdAt: watch.createdAt,
        updatedAt: watch.updatedAt,
        idempotencyPrefix: watch.idempotencyPrefix,
      });
    return watch;
  }

  getWatch(id: string): Watch | null {
    const row = this.db.prepare("SELECT * FROM watches WHERE id = ?").get(id) as
      | WatchRow
      | undefined;
    return row ? rowToWatch(row) : null;
  }

  listWatches(): Watch[] {
    const rows = this.db.prepare("SELECT * FROM watches ORDER BY created_at DESC").all() as WatchRow[];
    return rows.map(rowToWatch);
  }

  updateWatchStatus(id: string, status: Watch["status"]): void {
    this.db
      .prepare("UPDATE watches SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }

  recordRun(watchId: string, runNumber: number, results: LineCallResult[]): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO runs (watch_id, run_number, results, created_at) VALUES (?, ?, ?, ?)")
        .run(watchId, runNumber, JSON.stringify(results), new Date().toISOString());

      const upsertCall = this.db.prepare(`
        INSERT INTO calls (phone_e164, last_called_at) VALUES (?, ?)
        ON CONFLICT(phone_e164) DO UPDATE SET last_called_at = excluded.last_called_at
      `);
      const insertFact = this.db.prepare(`
        INSERT INTO facts (id, practice_id, phone_e164, fact_type, value, evidence, recorded_at, source_call_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of results) {
        // Cooldown is keyed by the number dialed, not the candidate id: the
        // gate at dispatch time looks a number up by phoneE164. Only
        // actually-placed calls record a timestamp; a blocked candidate was
        // never dialed.
        if (r.verdict !== "blocked") {
          upsertCall.run(r.phoneE164 ?? r.candidateId, r.completedAt);
        }
        if (r.verdict === "ghost") {
          insertFact.run(
            `fact-${watchId}-${r.candidateId}-${runNumber}`,
            r.candidateId,
            r.phoneE164 ?? r.candidateId,
            "line_dead",
            "ghost",
            r.evidence,
            r.completedAt,
            r.calleCallId ?? null,
          );
        }
      }
    });
    tx();
  }

  recordOptOut(phoneE164: string, reason = "user_requested"): void {
    this.db
      .prepare(
        "INSERT INTO opt_outs (phone_e164, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(phone_e164) DO NOTHING",
      )
      .run(phoneE164, reason, new Date().toISOString());
  }

  getWatchRunState(watchId: string): { runCount: number; lastRunAt: string | null } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count, MAX(created_at) AS last FROM runs WHERE watch_id = ?")
      .get(watchId) as { count: number; last: string | null };
    return { runCount: row.count, lastRunAt: row.last };
  }

  getLatestResults(watchId: string): LineCallResult[] {
    const rows = this.db
      .prepare("SELECT results FROM runs WHERE watch_id = ? ORDER BY run_number DESC LIMIT 1")
      .all(watchId) as Array<{ results: string }>;
    if (rows.length === 0) return [];
    return JSON.parse(rows[0]!.results) as LineCallResult[];
  }

  isOptedOut(phoneE164: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM opt_outs WHERE phone_e164 = ?").get(phoneE164);
  }

  lastCalledAt(phoneE164: string): Date | null {
    const row = this.db
      .prepare("SELECT last_called_at FROM calls WHERE phone_e164 = ?")
      .get(phoneE164) as { last_called_at: string } | undefined;
    return row ? new Date(row.last_called_at) : null;
  }

  listFacts(): Fact[] {
    const rows = this.db.prepare("SELECT * FROM facts ORDER BY recorded_at DESC").all() as FactRow[];
    return rows.map((row) => ({
      id: row.id,
      practiceId: row.practice_id,
      phoneE164: row.phone_e164,
      factType: row.fact_type,
      value: row.value,
      evidence: row.evidence,
      recordedAt: row.recorded_at,
      sourceCallId: row.source_call_id ?? undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}

interface WatchRow {
  id: string;
  spec: string;
  candidates: string;
  target_open: number;
  max_calls_per_run: number | null;
  status: Watch["status"];
  created_at: string;
  updated_at: string;
  idempotency_prefix: string;
}

interface FactRow {
  id: string;
  practice_id: string;
  phone_e164: string;
  fact_type: Fact["factType"];
  value: string;
  evidence: string;
  recorded_at: string;
  source_call_id: string | null;
}

function rowToWatch(row: WatchRow): Watch {
  return {
    id: row.id,
    spec: JSON.parse(row.spec) as SearchSpec,
    candidates: JSON.parse(row.candidates) as Candidate[],
    targetOpen: row.target_open,
    maxCallsPerRun: row.max_calls_per_run ?? 10,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    idempotencyPrefix: row.idempotency_prefix,
  };
}

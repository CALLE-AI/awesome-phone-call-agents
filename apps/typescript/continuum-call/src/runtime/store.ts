/**
 * Local durable mission store (SQLite via node:sqlite).
 * Survives CRASH RUNTIME memory drop so reconciler can rebuild frozen intents.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CallIntent,
  CallTask,
  Mission,
  MissionEvent,
  StructuredFact,
} from "./types.js";

export type ProviderStoredRun = {
  idempotency_key: string;
  call_id: string;
  payload_hash: string;
  scenario: string;
  create_count: number;
};

export type MissionSnapshot = {
  mission: Mission;
  tasks: CallTask[];
  intents: CallIntent[];
  facts: StructuredFact[];
  events: MissionEvent[];
  stop_dispatches: boolean;
  provider_runs: ProviderStoredRun[];
  task_labels: Record<string, string>;
  ledger_labels: string[];
  proof: string;
  handoff_json: string | null;
};

const DEFAULT_DB = join(process.cwd(), ".data", "continuum-call.sqlite");

export class MissionStore {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(dbPath = process.env.CONTINUUM_DB ?? DEFAULT_DB) {
    this.path = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        mission_id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        stop_dispatches INTEGER NOT NULL DEFAULT 0,
        proof TEXT NOT NULL DEFAULT '',
        handoff_json TEXT,
        ledger_labels_json TEXT NOT NULL DEFAULT '[]',
        task_labels_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS missions_idempotency_key_uq
        ON missions(json_extract(json, '$.mission_idempotency_key'));
      CREATE TABLE IF NOT EXISTS tasks (
        call_task_id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS intents (
        call_intent_id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS facts (
        mission_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (mission_id, idx)
      );
      CREATE TABLE IF NOT EXISTS events (
        mission_id TEXT NOT NULL,
        sequence_no INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (mission_id, sequence_no)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS events_event_id_uq
        ON events(json_extract(json, '$.event_id'));
      CREATE TABLE IF NOT EXISTS provider_runs (
        idempotency_key TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        provider_run_id TEXT,
        json TEXT NOT NULL
      );
      DROP INDEX IF EXISTS provider_runs_call_id_uq;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const providerRunColumns = this.db
      .prepare(`PRAGMA table_info(provider_runs)`)
      .all() as Array<{ name: string }>;
    if (!providerRunColumns.some((column) => column.name === "provider_run_id")) {
      this.db.exec(`ALTER TABLE provider_runs ADD COLUMN provider_run_id TEXT;`);
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_runs_provider_run_id_uq
        ON provider_runs(provider_run_id)
        WHERE provider_run_id IS NOT NULL;
    `);
  }

  setActiveMission(missionId: string): void {
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES('active_mission', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(missionId);
  }

  getActiveMissionId(): string | null {
    const row = this.db
      .prepare(`SELECT value FROM meta WHERE key = 'active_mission'`)
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  loadSnapshotByIdempotencyKey(key: string): MissionSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT mission_id FROM missions
         WHERE json_extract(json, '$.mission_idempotency_key') = ?`,
      )
      .get(key) as { mission_id: string } | undefined;
    return row ? this.loadSnapshot(row.mission_id) : null;
  }

  saveSnapshot(snap: MissionSnapshot): void {
    const now = new Date().toISOString();
    const tx = this.db.prepare("BEGIN IMMEDIATE");
    const commit = this.db.prepare("COMMIT");
    const rollback = this.db.prepare("ROLLBACK");
    tx.run();
    try {
      this.db
        .prepare(
          `INSERT INTO missions(mission_id, json, stop_dispatches, proof, handoff_json, ledger_labels_json, task_labels_json, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(mission_id) DO UPDATE SET
             json = excluded.json,
             stop_dispatches = excluded.stop_dispatches,
             proof = excluded.proof,
             handoff_json = excluded.handoff_json,
             ledger_labels_json = excluded.ledger_labels_json,
             task_labels_json = excluded.task_labels_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          snap.mission.mission_id,
          JSON.stringify(snap.mission),
          snap.stop_dispatches ? 1 : 0,
          snap.proof,
          snap.handoff_json,
          JSON.stringify(snap.ledger_labels),
          JSON.stringify(snap.task_labels),
          now,
        );

      this.db
        .prepare(`DELETE FROM tasks WHERE mission_id = ?`)
        .run(snap.mission.mission_id);
      this.db
        .prepare(`DELETE FROM intents WHERE mission_id = ?`)
        .run(snap.mission.mission_id);
      this.db
        .prepare(`DELETE FROM facts WHERE mission_id = ?`)
        .run(snap.mission.mission_id);
      this.db
        .prepare(`DELETE FROM provider_runs WHERE mission_id = ?`)
        .run(snap.mission.mission_id);

      const insTask = this.db.prepare(
        `INSERT INTO tasks(call_task_id, mission_id, json) VALUES(?, ?, ?)`,
      );
      for (const t of snap.tasks) {
        insTask.run(t.call_task_id, snap.mission.mission_id, JSON.stringify(t));
      }

      const insIntent = this.db.prepare(
        `INSERT INTO intents(call_intent_id, mission_id, json) VALUES(?, ?, ?)`,
      );
      for (const i of snap.intents) {
        insIntent.run(
          i.call_intent_id,
          snap.mission.mission_id,
          JSON.stringify(i),
        );
      }

      const insFact = this.db.prepare(
        `INSERT INTO facts(mission_id, idx, json) VALUES(?, ?, ?)`,
      );
      snap.facts.forEach((f, idx) => {
        insFact.run(snap.mission.mission_id, idx, JSON.stringify(f));
      });

      const existingEventCount = this.db
        .prepare(`SELECT COUNT(*) AS count FROM events WHERE mission_id = ?`)
        .get(snap.mission.mission_id) as { count: number };
      if (existingEventCount.count > snap.events.length) {
        throw new Error("APPEND_ONLY_EVENT_TRUNCATION");
      }
      const getEv = this.db.prepare(
        `SELECT json FROM events WHERE mission_id = ? AND sequence_no = ?`,
      );
      const insEv = this.db.prepare(
        `INSERT INTO events(mission_id, sequence_no, json) VALUES(?, ?, ?)`,
      );
      for (const e of snap.events) {
        const encoded = JSON.stringify(e);
        const existing = getEv.get(
          snap.mission.mission_id,
          e.sequence_no,
        ) as { json: string } | undefined;
        if (existing) {
          if (existing.json !== encoded) {
            throw new Error(
              `APPEND_ONLY_EVENT_CONFLICT seq=${e.sequence_no}`,
            );
          }
          continue;
        }
        insEv.run(snap.mission.mission_id, e.sequence_no, encoded);
      }

      const insProv = this.db.prepare(
        `INSERT INTO provider_runs(idempotency_key, mission_id, provider_run_id, json)
         VALUES(?, ?, ?, ?)`,
      );
      for (const p of snap.provider_runs) {
        insProv.run(
          p.idempotency_key,
          snap.mission.mission_id,
          p.call_id,
          JSON.stringify(p),
        );
      }

      this.setActiveMission(snap.mission.mission_id);
      commit.run();
    } catch (e) {
      rollback.run();
      throw e;
    }
  }

  loadSnapshot(missionId: string): MissionSnapshot | null {
    const m = this.db
      .prepare(
        `SELECT json, stop_dispatches, proof, handoff_json, ledger_labels_json, task_labels_json
         FROM missions WHERE mission_id = ?`,
      )
      .get(missionId) as
      | {
          json: string;
          stop_dispatches: number;
          proof: string;
          handoff_json: string | null;
          ledger_labels_json: string;
          task_labels_json: string;
        }
      | undefined;
    if (!m) return null;

    const tasks = (
      this.db
        .prepare(`SELECT json FROM tasks WHERE mission_id = ?`)
        .all(missionId) as Array<{ json: string }>
    ).map((r) => JSON.parse(r.json) as CallTask);

    const intents = (
      this.db
        .prepare(`SELECT json FROM intents WHERE mission_id = ?`)
        .all(missionId) as Array<{ json: string }>
    ).map((r) => JSON.parse(r.json) as CallIntent);

    const facts = (
      this.db
        .prepare(
          `SELECT json FROM facts WHERE mission_id = ? ORDER BY idx ASC`,
        )
        .all(missionId) as Array<{ json: string }>
    ).map((r) => JSON.parse(r.json) as StructuredFact);

    const events = (
      this.db
        .prepare(
          `SELECT json FROM events WHERE mission_id = ? ORDER BY sequence_no ASC`,
        )
        .all(missionId) as Array<{ json: string }>
    ).map((r) => JSON.parse(r.json) as MissionEvent);

    const provider_runs = (
      this.db
        .prepare(`SELECT json FROM provider_runs WHERE mission_id = ?`)
        .all(missionId) as Array<{ json: string }>
    ).map((r) => JSON.parse(r.json) as ProviderStoredRun);

    return {
      mission: JSON.parse(m.json) as Mission,
      tasks,
      intents,
      facts,
      events,
      stop_dispatches: Boolean(m.stop_dispatches),
      provider_runs,
      task_labels: JSON.parse(m.task_labels_json) as Record<string, string>,
      ledger_labels: JSON.parse(m.ledger_labels_json) as string[],
      proof: m.proof,
      handoff_json: m.handoff_json,
    };
  }

  listStuckIntentIds(missionId: string): string[] {
    const snap = this.loadSnapshot(missionId);
    if (!snap) return [];
    return snap.intents
      .filter((i) => i.state === "dispatching" || i.state === "ambiguous")
      .map((i) => i.call_intent_id);
  }

  close(): void {
    this.db.close();
  }
}

export function defaultStorePath(): string {
  return DEFAULT_DB;
}

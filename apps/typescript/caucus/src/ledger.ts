/**
 * Hash-chained, append-only case ledger on better-sqlite3.
 *
 * Every entry is chained per case: `hash = SHA-256(prevHash + canonical(entry))`,
 * where `canonical()` is a stable-key-order JSON serialization and the first
 * entry of a case links to {@link GENESIS_HASH}. Changing any byte of meaning
 * in a stored entry (payload, type, epoch, timestamp, sequence) invalidates
 * that entry's hash; rewriting the hash too breaks the successor's `prevHash`
 * link. {@link Ledger.verifyChain} recomputes the whole chain and reports the
 * first break.
 *
 * The ledger is the durability story for the state machine: `transition()`
 * emits ledger event drafts, callers append them (atomically via
 * {@link Ledger.appendMany}), and `rehydrate()` reconstructs any CaseRecord
 * from these entries alone.
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { LedgerEntry, LedgerEventType } from "./types.js";

/** prevHash of the first entry in every per-case chain. */
export const GENESIS_HASH = "0".repeat(64);

const LEDGER_EVENT_TYPES: ReadonlySet<string> = new Set([
  "case_created",
  "consent_recorded",
  "consent_declined",
  "round_started",
  "offer_recorded",
  "round_failed",
  "settlement_proposed",
  "attestation_recorded",
  "case_settled",
  "case_impasse",
  "case_cancelled",
  "case_expired",
] satisfies LedgerEventType[]);

/**
 * Deterministic JSON serialization: object keys sorted recursively, array
 * order preserved, `undefined` object properties dropped (JSON semantics),
 * `toJSON()` honored (so Dates serialize as ISO strings). Values JSON cannot
 * faithfully represent (NaN/Infinity, bigint, functions, symbols) throw
 * instead of being silently coerced — a tamper-evidence log must never guess.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalize: non-finite number ${value}`);
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => (v === undefined ? "null" : canonicalize(v)));
    return `[${items.join(",")}]`;
  }
  const obj = value as Record<string, unknown> & { toJSON?: () => unknown };
  if (typeof obj.toJSON === "function") return canonicalize(obj.toJSON());
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const members = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${members.join(",")}}`;
}

/** SHA-256 hex over `prevHash + canonical({seq, caseId, epoch, type, payload, at})`. */
export function computeEntryHash(entry: Omit<LedgerEntry, "hash">): string {
  const { seq, caseId, epoch, type, payload, at, prevHash } = entry;
  const content = canonicalize({ seq, caseId, epoch, type, payload, at });
  return createHash("sha256").update(prevHash + content, "utf8").digest("hex");
}

/** What callers provide; seq/hash/prevHash are assigned by the ledger. */
export type LedgerAppendInput = Omit<LedgerEntry, "seq" | "hash" | "prevHash">;

export interface ChainVerification {
  ok: boolean;
  /** Sequence number of the first entry whose hash or link fails. */
  brokenAtSeq?: number;
}

export interface Ledger {
  /** Appends one entry, chaining it to the previous entry of the same case. */
  append(entry: LedgerAppendInput): LedgerEntry;
  /**
   * Appends a batch in a single immediate transaction — all or nothing.
   * Use this for the `ledgerEvents` of one state transition so a crash can
   * never persist half a transition.
   */
  appendMany(entries: LedgerAppendInput[]): LedgerEntry[];
  /** All entries for a case, ascending by seq, payloads parsed. */
  entries(caseId: string): LedgerEntry[];
  /** Recomputes every hash + link of the case chain. */
  verifyChain(caseId: string): ChainVerification;
  close(): void;
}

interface LedgerRow {
  seq: number;
  case_id: string;
  epoch: number;
  type: string;
  payload: string;
  at: string;
  hash: string;
  prev_hash: string;
}

export function openLedger(dbPath: string): Ledger {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      seq       INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id   TEXT    NOT NULL,
      epoch     INTEGER NOT NULL,
      type      TEXT    NOT NULL,
      payload   TEXT    NOT NULL,
      at        TEXT    NOT NULL,
      hash      TEXT    NOT NULL,
      prev_hash TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_case_seq ON ledger (case_id, seq);
  `);

  const nextSeqStmt = db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ledger");
  const lastHashStmt = db.prepare(
    "SELECT hash FROM ledger WHERE case_id = ? ORDER BY seq DESC LIMIT 1",
  );
  const insertStmt = db.prepare(
    `INSERT INTO ledger (seq, case_id, epoch, type, payload, at, hash, prev_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byCaseStmt = db.prepare(
    "SELECT seq, case_id, epoch, type, payload, at, hash, prev_hash FROM ledger WHERE case_id = ? ORDER BY seq ASC",
  );

  function insertOne(input: LedgerAppendInput): LedgerEntry {
    if (typeof input.caseId !== "string" || input.caseId.length === 0) {
      throw new TypeError("ledger.append: caseId must be a non-empty string");
    }
    if (!Number.isInteger(input.epoch) || input.epoch < 0) {
      throw new TypeError("ledger.append: epoch must be a non-negative integer");
    }
    if (!LEDGER_EVENT_TYPES.has(input.type)) {
      throw new TypeError(`ledger.append: unknown event type "${input.type}"`);
    }
    if (typeof input.at !== "string" || input.at.length === 0) {
      throw new TypeError("ledger.append: at must be a non-empty timestamp string");
    }
    if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload)) {
      throw new TypeError("ledger.append: payload must be a plain object");
    }
    // Canonicalize before touching the table: a non-serializable payload must
    // abort (and, inside appendMany, roll back) without a partial write.
    const payloadJson = canonicalize(input.payload);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    const seq = (nextSeqStmt.get() as { next: number }).next;
    const prevRow = lastHashStmt.get(input.caseId) as { hash: string } | undefined;
    const prevHash = prevRow?.hash ?? GENESIS_HASH;
    const unhashed: Omit<LedgerEntry, "hash"> = {
      seq,
      caseId: input.caseId,
      epoch: input.epoch,
      type: input.type,
      payload,
      at: input.at,
      prevHash,
    };
    const hash = computeEntryHash(unhashed);
    insertStmt.run(seq, input.caseId, input.epoch, input.type, payloadJson, input.at, hash, prevHash);
    return { ...unhashed, hash };
  }

  const appendManyTx = db.transaction((inputs: LedgerAppendInput[]) => inputs.map(insertOne));

  function rowToEntry(row: LedgerRow): LedgerEntry {
    return {
      seq: row.seq,
      caseId: row.case_id,
      epoch: row.epoch,
      type: row.type as LedgerEventType,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      at: row.at,
      hash: row.hash,
      prevHash: row.prev_hash,
    };
  }

  return {
    append(entry) {
      const [appended] = appendManyTx.immediate([entry]);
      // The transaction inserts exactly one row for a one-element batch.
      return appended as LedgerEntry;
    },

    appendMany(entries) {
      return appendManyTx.immediate(entries);
    },

    entries(caseId) {
      return (byCaseStmt.all(caseId) as LedgerRow[]).map(rowToEntry);
    },

    verifyChain(caseId) {
      let prev = GENESIS_HASH;
      for (const row of byCaseStmt.all(caseId) as LedgerRow[]) {
        let entry: LedgerEntry;
        try {
          entry = rowToEntry(row);
        } catch {
          return { ok: false, brokenAtSeq: row.seq };
        }
        if (entry.prevHash !== prev) return { ok: false, brokenAtSeq: entry.seq };
        const expected = computeEntryHash({
          seq: entry.seq,
          caseId: entry.caseId,
          epoch: entry.epoch,
          type: entry.type,
          payload: entry.payload,
          at: entry.at,
          prevHash: prev,
        });
        if (entry.hash !== expected) return { ok: false, brokenAtSeq: entry.seq };
        prev = entry.hash;
      }
      return { ok: true };
    },

    close() {
      db.close();
    },
  };
}

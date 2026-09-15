import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * Append-only JSONL ledger. One line per CALL-E call task that Roll Call
 * created. Its job is to make sure one guardian is dialled at most once per
 * student per day, even if the process crashes and is re-run.
 *
 * The idempotency key stored here is the same key sent to CALL-E in the
 * `Idempotency-Key` header, so a re-run that slips past the ledger is still
 * de-duplicated on the server.
 */
export interface LedgerEntry {
  idempotencyKey: string;
  studentId: string;
  guardianIndex: number;
  callId: string;
  createdAt: string;
  mode: "dry-run" | "live";
  /** Who that call reached, so a re-run knows whether the cascade already ended. */
  answeredBy: string | null;
}

export function idempotencyKey(date: string, studentId: string, guardianIndex: number): string {
  const safe = studentId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `rollcall_${date}_${safe}_g${guardianIndex + 1}`;
}

export class Ledger {
  private readonly entries = new Map<string, LedgerEntry>();

  constructor(private readonly path: string | null) {
    if (path && existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as LedgerEntry;
        this.entries.set(entry.idempotencyKey, entry);
      }
    }
  }

  get(key: string): LedgerEntry | undefined {
    return this.entries.get(key);
  }

  record(entry: LedgerEntry): void {
    this.entries.set(entry.idempotencyKey, entry);
    if (this.path) appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  size(): number {
    return this.entries.size;
  }
}

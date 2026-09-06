/**
 * Hash-chained, tamper-evident audit log for attestation records.
 *
 * Each record's hash covers its own canonical content PLUS the previous
 * record's hash, so any retroactive edit to an earlier record invalidates
 * every hash after it. This is a lightweight, dependency-free integrity
 * mechanism suitable for a compliance evidence trail.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditRecord } from "./types.js";

const GENESIS = "GENESIS";

/** Canonical JSON stringify with sorted keys for stable hashing. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** Compute the SHA-256 hash for a record, excluding the `hash` field itself. */
export function computeHash(record: Omit<AuditRecord, "hash">): string {
  return createHash("sha256").update(canonical(record)).digest("hex");
}

export class AuditChain {
  private records: AuditRecord[] = [];

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) {
        this.records = raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AuditRecord);
      }
    }
  }

  get length(): number {
    return this.records.length;
  }

  all(): readonly AuditRecord[] {
    return this.records;
  }

  /** Seal a new record onto the chain and persist it. */
  append(entry: Omit<AuditRecord, "index" | "sealedAt" | "prevHash" | "hash">): AuditRecord {
    const index = this.records.length;
    const prevHash = index === 0 ? GENESIS : this.records[index - 1]!.hash;
    const base: Omit<AuditRecord, "hash"> = {
      ...entry,
      index,
      sealedAt: new Date().toISOString(),
      prevHash,
    };
    const hash = computeHash(base);
    const record: AuditRecord = { ...base, hash };
    this.records.push(record);
    this.persist(record);
    return record;
  }

  /** Verify the whole chain. Returns the first broken index, or null if intact. */
  verify(): { intact: boolean; brokenAt: number | null } {
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]!;
      const expectedPrev = i === 0 ? GENESIS : this.records[i - 1]!.hash;
      if (rec.prevHash !== expectedPrev) return { intact: false, brokenAt: i };
      const { hash, ...rest } = rec;
      if (computeHash(rest) !== hash) return { intact: false, brokenAt: i };
    }
    return { intact: true, brokenAt: null };
  }

  private persist(record: AuditRecord): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(record) + "\n", { flag: "a" });
  }
}

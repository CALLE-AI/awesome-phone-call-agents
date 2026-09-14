import { randomUUID } from "node:crypto";

export type AuditEntry = {
  entryId: string;
  actor: "system" | "user" | "admin" | "webhook";
  actorUserId?: number;
  action: string;
  correlationId: string;
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: string;
};

const ledger: AuditEntry[] = [];

export function resetAuditLedger() {
  ledger.length = 0;
}

export function appendAuditEntry(input: Omit<AuditEntry, "entryId" | "at">): AuditEntry {
  const entry: AuditEntry = {
    entryId: randomUUID().replace(/-/g, "").slice(0, 24),
    at: new Date().toISOString(),
    ...input,
  };
  ledger.push(entry);
  return entry;
}

export function listAuditEntries(opts?: { userId?: number; limit?: number }): AuditEntry[] {
  let rows = [...ledger];
  if (opts?.userId !== undefined) {
    rows = rows.filter((e) => e.actorUserId === opts.userId);
  }
  rows.reverse();
  if (opts?.limit) rows = rows.slice(0, opts.limit);
  return rows;
}

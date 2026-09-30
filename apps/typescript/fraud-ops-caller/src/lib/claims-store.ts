import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ClaimRecord =
  | { state: "in_flight"; caseId: string; at: string }
  | { state: "done"; caseId: string; at: string; result: unknown }
  | {
      state: "needs_reconciliation";
      caseId: string;
      at: string;
      reason: string;
      result?: unknown;
    };

export type HaltRecord = {
  caseId: string;
  reason: string;
  at: string;
  key: string;
};

type StoreFile = {
  byKey: Record<string, ClaimRecord>;
  haltByCase: Record<string, HaltRecord>;
};

function emptyStore(): StoreFile {
  return { byKey: {}, haltByCase: {} };
}

function claimsPath(): string {
  return process.env.CALL_CLAIMS_PATH?.trim() || ".data/call-claims.json";
}

let memory: StoreFile | null = null;

function load(): StoreFile {
  if (memory) return memory;
  try {
    const raw = JSON.parse(readFileSync(claimsPath(), "utf8")) as StoreFile;
    if (!raw || typeof raw !== "object" || !raw.byKey || !raw.haltByCase) {
      memory = emptyStore();
      return memory;
    }
    memory = raw;
    return memory;
  } catch {
    memory = emptyStore();
    return memory;
  }
}

function persist(store: StoreFile): void {
  memory = store;
  const path = claimsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

export function resetClaimsStore(): void {
  memory = emptyStore();
  const path = claimsPath();
  try {
    writeFileSync(path, JSON.stringify(memory), { encoding: "utf8", mode: 0o600 });
  } catch {
    memory = emptyStore();
  }
}

export function getClaim(key: string): ClaimRecord | undefined {
  return load().byKey[key];
}

export function getHalt(caseId: string): HaltRecord | undefined {
  return load().haltByCase[caseId];
}

export function setClaim(key: string, record: ClaimRecord): void {
  const store = load();
  store.byKey[key] = record;
  persist(store);
}

export function deleteClaim(key: string): void {
  const store = load();
  delete store.byKey[key];
  persist(store);
}

export function haltCase(caseId: string, key: string, reason: string): void {
  const store = load();
  const at = new Date().toISOString();
  store.haltByCase[caseId] = { caseId, reason, at, key };
  const prior = store.byKey[key];
  store.byKey[key] = {
    state: "needs_reconciliation",
    caseId,
    at,
    reason,
    result: prior && "result" in prior ? prior.result : undefined,
  };
  persist(store);
}

export function forceHaltForTests(caseId: string, reason = "outcome_unknown"): void {
  haltCase(caseId, `test:${caseId}`, reason);
}

export function dropClaimsMemoryForTests(): void {
  memory = null;
}

/**
 * CLI case store — the thin adapter between the CLI's storage contract and the
 * hash-chained ledger.
 *
 * There is deliberately no separate case table: the ledger IS the store.
 * `getCase` rehydrates the record by replaying the case's chain, which keeps
 * the CLI on exactly the same crash-recovery path as everything else — if the
 * chain and the record could disagree, rehydration wins, so they cannot.
 *
 * History note: the CLI originally resolved this module by convention with a
 * dynamic import, and the module did not exist — every `caucus open` from a
 * real terminal failed while all tests passed with injected dependencies. The
 * wiring is now static and typechecked precisely so a missing seam like that
 * can never survive `tsc` again.
 */
import type { CaseRecord, LedgerEntry, LedgerEventType } from "./types.js";
import type { ChainVerdict, CliStore } from "./cli.js";
import { GENESIS_HASH, computeEntryHash, openLedger, type Ledger } from "./ledger.js";
import { rehydrate } from "./state.js";

/** The concrete store: the CLI contract plus direct access to the ledger. */
export interface LedgerStore extends CliStore {
  /** The underlying ledger, for callers that need transactional appendMany. */
  ledger: Ledger;
}

export function openStore(dbPath: string): LedgerStore {
  const ledger = openLedger(dbPath);
  return {
    ledger,

    // The ledger is the single source of truth; a CaseRecord is always
    // derivable by replay, so persisting it separately could only create a
    // second, disagreeing copy. Accepting and discarding the record keeps the
    // CLI contract satisfied without inventing a second store.
    saveCase(_rec: CaseRecord): void {},

    getCase(caseId: string): CaseRecord | undefined {
      const entries = ledger.entries(caseId);
      return entries.length === 0 ? undefined : rehydrate(caseId, entries);
    },

    getLedger(caseId: string): LedgerEntry[] {
      return ledger.entries(caseId);
    },

    appendLedger(
      caseId: string,
      epoch: number,
      type: LedgerEventType,
      payload: Record<string, unknown>,
    ): LedgerEntry {
      return ledger.append({ caseId, epoch, type, payload, at: new Date().toISOString() });
    },

    close(): void {
      ledger.close();
    },
  };
}

/**
 * Standalone chain verification over an already-loaded entries array (the
 * CLI's `verify` command works on `getLedger()` output). Same rules as
 * `Ledger.verifyChain`: per-case linkage from the genesis sentinel, and every
 * hash recomputed from the entry's own content.
 */
export function verifyEntries(entries: LedgerEntry[]): ChainVerdict {
  let prevHash = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== prevHash) return { ok: false, brokenAtSeq: entry.seq };
    const expected = computeEntryHash({
      seq: entry.seq,
      caseId: entry.caseId,
      epoch: entry.epoch,
      type: entry.type,
      payload: entry.payload,
      at: entry.at,
      prevHash: entry.prevHash,
    });
    if (entry.hash !== expected) return { ok: false, brokenAtSeq: entry.seq };
    prevHash = entry.hash;
  }
  return { ok: true };
}

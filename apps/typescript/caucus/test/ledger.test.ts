/**
 * Ledger: canonical serialization, per-case hash chaining, and tamper evidence.
 *
 * Every test gets a fresh sqlite file under its own mkdtemp directory. Tamper
 * tests open that file with a *second* better-sqlite3 connection and rewrite
 * rows directly — exactly what an attacker with disk access would do — then
 * reopen the ledger and assert `verifyChain` names the first broken sequence.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";

import {
  GENESIS_HASH,
  canonicalize,
  computeEntryHash,
  openLedger,
  type Ledger,
  type LedgerAppendInput,
} from "../src/ledger.js";
import type { LedgerEntry } from "../src/types.js";

// ---------- Fixtures ----------

const CASE_A = "cs_ledger_a";
const CASE_B = "cs_ledger_b";
const AT_0 = "2026-07-30T12:00:00.000Z";

function input(overrides: Partial<LedgerAppendInput> = {}): LedgerAppendInput {
  return {
    caseId: CASE_A,
    epoch: 1,
    type: "consent_recorded",
    // Fictional/masked numbers only — nothing here is dialable.
    payload: { party: "A", callId: "call_0001", phone: "+15550000001", consent: "yes" },
    at: AT_0,
    ...overrides,
  };
}

let dir: string;
let dbPath: string;
let ledger: Ledger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caucus-ledger-"));
  dbPath = join(dir, "nested", "caucus.db");
  ledger = openLedger(dbPath);
});

afterEach(() => {
  try {
    ledger.close();
  } catch {
    // Already closed by a tamper helper that failed mid-way; the file goes anyway.
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Close the ledger, mutate the raw sqlite file, reopen it. */
function tamper(mutate: (raw: Database.Database) => void): void {
  ledger.close();
  const raw = new Database(dbPath);
  try {
    mutate(raw);
  } finally {
    raw.close();
  }
  ledger = openLedger(dbPath);
}

/** Append `n` chained entries for `caseId` (entry 1 is the genesis event). */
function seed(caseId: string, n: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (let i = 1; i <= n; i += 1) {
    out.push(
      ledger.append(
        input({
          caseId,
          epoch: i,
          type: i === 1 ? "case_created" : "offer_recorded",
          payload: { round: i, amountCents: 1000 * i, conditions: [] },
          at: `2026-07-30T12:0${i}:00.000Z`,
        }),
      ),
    );
  }
  return out;
}

function nth(entries: readonly LedgerEntry[], i: number): LedgerEntry {
  const e = entries[i];
  if (e === undefined) throw new Error(`fixture: no entry at index ${i}`);
  return e;
}

// ---------- canonicalize ----------

describe("canonicalize", () => {
  it("sorts object keys, so insertion order cannot change the bytes", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively while preserving array order", () => {
    expect(canonicalize({ z: [{ y: 1, x: 2 }, [3, 1, 2]], a: "s" })).toBe(
      '{"a":"s","z":[{"x":2,"y":1},[3,1,2]]}',
    );
  });

  it("serializes primitives exactly as JSON does", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(-12.5)).toBe("-12.5");
    expect(canonicalize("x")).toBe('"x"');
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({})).toBe("{}");
  });

  it("drops undefined object properties and nulls undefined array slots", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("honors toJSON, so Dates serialize as ISO strings", () => {
    expect(canonicalize({ at: new Date("2026-07-30T12:00:00.000Z") })).toBe(
      '{"at":"2026-07-30T12:00:00.000Z"}',
    );
  });

  it("round-trips unicode payload text unchanged", () => {
    // Accented Latin, symbols, and an emoji exercise multi-byte round-tripping
    // (repository content is English-only, so no CJK in the fixture).
    const payload = { note: "café ☎ señor Zürich — 100% done", emoji: "🧾" };
    // Keys come back sorted (that is canonicalize's job), so this is deliberately
    // NOT compared against JSON.stringify's insertion order — only the text must
    // survive byte-for-byte, unescaped and unnormalized.
    expect(canonicalize(payload)).toBe('{"emoji":"🧾","note":"café ☎ señor Zürich — 100% done"}');
    expect(JSON.parse(canonicalize(payload))).toEqual(payload);
  });

  it("orders unicode keys by UTF-16 code unit", () => {
    expect(canonicalize({ "é": 1, z: 2, a: 3, "10": 4 })).toBe('{"10":4,"a":3,"z":2,"é":1}');
  });

  it("distinguishes NFC from NFD (byte-exact, never silently normalized)", () => {
    const nfc = { c: "café" }; // single code point
    const nfd = { c: "café" };
    expect(nfc.c).not.toBe(nfd.c);
    expect(nfc.c.normalize("NFD")).toBe(nfd.c);
    expect(canonicalize(nfc)).not.toBe(canonicalize(nfd));
    // Same glyphs on screen, different hash — the ledger never guesses intent.
    const hashOf = (payload: Record<string, unknown>): string =>
      computeEntryHash({
        seq: 1,
        caseId: CASE_A,
        epoch: 0,
        type: "case_created",
        payload,
        at: AT_0,
        prevHash: GENESIS_HASH,
      });
    expect(hashOf(nfc)).not.toBe(hashOf(nfd));
  });

  it("throws rather than coerce values JSON cannot represent faithfully", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalize({ nested: { deep: Number.NaN } })).toThrow(TypeError);
    expect(() => canonicalize([1, Number.NEGATIVE_INFINITY])).toThrow(TypeError);
    expect(() => canonicalize(10n)).toThrow(TypeError);
    expect(() => canonicalize(Symbol("s"))).toThrow(TypeError);
    expect(() => canonicalize(() => undefined)).toThrow(TypeError);
    expect(() => canonicalize({ fn: () => undefined })).toThrow(TypeError);
  });

  it("property: output depends on the key set, never on insertion order", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 8 }).filter((k) => k !== "__proto__"),
          fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
        ),
        (obj) => {
          const keys = Object.keys(obj);
          const base = canonicalize(obj);
          const orders = [[...keys].reverse(), [...keys].sort(), [...keys].sort().reverse()];
          for (const order of orders) {
            const rebuilt: Record<string, unknown> = {};
            for (const k of order) rebuilt[k] = obj[k];
            expect(canonicalize(rebuilt)).toBe(base);
          }
          expect(JSON.parse(base)).toEqual(obj);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------- computeEntryHash ----------

describe("computeEntryHash", () => {
  it("is SHA-256 over prevHash concatenated with the canonical entry", () => {
    const entry = {
      seq: 1,
      caseId: CASE_A,
      epoch: 0,
      type: "case_created" as const,
      payload: { b: 2, a: 1 },
      at: AT_0,
      prevHash: GENESIS_HASH,
    };
    const expected = createHash("sha256")
      .update(
        GENESIS_HASH +
          canonicalize({
            seq: entry.seq,
            caseId: entry.caseId,
            epoch: entry.epoch,
            type: entry.type,
            payload: entry.payload,
            at: entry.at,
          }),
        "utf8",
      )
      .digest("hex");
    expect(computeEntryHash(entry)).toBe(expected);
    expect(computeEntryHash(entry)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the entry to its predecessor: a different prevHash is a different hash", () => {
    const base = {
      seq: 2,
      caseId: CASE_A,
      epoch: 1,
      type: "offer_recorded" as const,
      payload: { amountCents: 50_000 },
      at: AT_0,
      prevHash: GENESIS_HASH,
    };
    expect(computeEntryHash(base)).not.toBe(
      computeEntryHash({ ...base, prevHash: "f".repeat(64) }),
    );
  });

  it("is insensitive to payload key order but sensitive to every other field", () => {
    const base = {
      seq: 2,
      caseId: CASE_A,
      epoch: 1,
      type: "offer_recorded" as const,
      payload: { amountCents: 50_000, round: 2 },
      at: AT_0,
      prevHash: GENESIS_HASH,
    };
    const h = computeEntryHash(base);
    expect(computeEntryHash({ ...base, payload: { round: 2, amountCents: 50_000 } })).toBe(h);
    expect(computeEntryHash({ ...base, seq: 3 })).not.toBe(h);
    expect(computeEntryHash({ ...base, caseId: CASE_B })).not.toBe(h);
    expect(computeEntryHash({ ...base, epoch: 2 })).not.toBe(h);
    expect(computeEntryHash({ ...base, type: "round_failed" })).not.toBe(h);
    expect(computeEntryHash({ ...base, at: "2026-07-30T12:00:00.001Z" })).not.toBe(h);
    expect(computeEntryHash({ ...base, payload: { amountCents: 50_001, round: 2 } })).not.toBe(h);
  });
});

// ---------- append / read back ----------

describe("append and read back", () => {
  it("assigns ascending seqs and returns entries in seq order", () => {
    const appended = seed(CASE_A, 4);
    expect(appended.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const read = ledger.entries(CASE_A);
    expect(read.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(read).toEqual(appended);
  });

  it("links the first entry of a case to GENESIS_HASH", () => {
    const [first] = seed(CASE_A, 3);
    expect(first?.prevHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toBe("0".repeat(64));
  });

  it("chains every entry to its predecessor's hash", () => {
    const entries = seed(CASE_A, 5);
    for (let i = 1; i < entries.length; i += 1) {
      expect(nth(entries, i).prevHash).toBe(nth(entries, i - 1).hash);
    }
  });

  it("stores a hash that recomputes from the persisted fields alone", () => {
    seed(CASE_A, 3);
    let prev = GENESIS_HASH;
    for (const e of ledger.entries(CASE_A)) {
      expect(e.prevHash).toBe(prev);
      expect(e.hash).toBe(
        computeEntryHash({
          seq: e.seq,
          caseId: e.caseId,
          epoch: e.epoch,
          type: e.type,
          payload: e.payload,
          at: e.at,
          prevHash: e.prevHash,
        }),
      );
      prev = e.hash;
    }
  });

  it("keeps per-case chains independent when two cases interleave", () => {
    const a1 = ledger.append(input({ caseId: CASE_A, type: "case_created", payload: { n: 1 } }));
    const b1 = ledger.append(input({ caseId: CASE_B, type: "case_created", payload: { n: 1 } }));
    const a2 = ledger.append(input({ caseId: CASE_A, type: "offer_recorded", payload: { n: 2 } }));
    const b2 = ledger.append(input({ caseId: CASE_B, type: "offer_recorded", payload: { n: 2 } }));
    const a3 = ledger.append(input({ caseId: CASE_A, type: "offer_recorded", payload: { n: 3 } }));

    // The seq counter is table-global: the two cases interleave in one table...
    expect([a1.seq, b1.seq, a2.seq, b2.seq, a3.seq]).toEqual([1, 2, 3, 4, 5]);
    // ...but each chain only ever links to its own case.
    expect(a1.prevHash).toBe(GENESIS_HASH);
    expect(b1.prevHash).toBe(GENESIS_HASH);
    expect(a2.prevHash).toBe(a1.hash);
    expect(a3.prevHash).toBe(a2.hash);
    expect(b2.prevHash).toBe(b1.hash);
    expect(ledger.entries(CASE_A).map((e) => e.seq)).toEqual([1, 3, 5]);
    expect(ledger.entries(CASE_B).map((e) => e.seq)).toEqual([2, 4]);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
    expect(ledger.verifyChain(CASE_B)).toEqual({ ok: true });
  });

  it("returns an empty list for a case with no entries", () => {
    seed(CASE_A, 2);
    expect(ledger.entries("cs_never_used")).toEqual([]);
  });

  it("persists payloads canonically (keys sorted on the way in)", () => {
    ledger.append(input({ type: "case_created", payload: { zeta: 1, alpha: { d: 4, c: 3 } } }));
    const [entry] = ledger.entries(CASE_A);
    expect(Object.keys(entry?.payload ?? {})).toEqual(["alpha", "zeta"]);
    expect(Object.keys((entry?.payload as { alpha: object }).alpha)).toEqual(["c", "d"]);
  });

  it("appendMany writes the whole batch in seq order", () => {
    const batch = ledger.appendMany([
      input({ type: "case_created", epoch: 0, payload: { n: 1 } }),
      input({ type: "offer_recorded", epoch: 1, payload: { n: 2 } }),
      input({ type: "settlement_proposed", epoch: 1, payload: { n: 3 } }),
    ]);
    expect(batch.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(batch.map((e) => e.type)).toEqual([
      "case_created",
      "offer_recorded",
      "settlement_proposed",
    ]);
    expect(nth(batch, 1).prevHash).toBe(nth(batch, 0).hash);
    expect(nth(batch, 2).prevHash).toBe(nth(batch, 1).hash);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
  });

  it("appendMany is atomic: one rejected entry rolls the whole batch back", () => {
    seed(CASE_A, 2);
    expect(() =>
      ledger.appendMany([
        input({ type: "offer_recorded", payload: { n: 3 } }),
        input({ type: "not_a_real_event" as LedgerAppendInput["type"], payload: { n: 4 } }),
      ]),
    ).toThrow(TypeError);
    expect(ledger.entries(CASE_A)).toHaveLength(2);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
  });

  it("rejects a payload that cannot be canonicalized, without a partial write", () => {
    seed(CASE_A, 1);
    expect(() => ledger.append(input({ payload: { amountCents: Number.NaN } }))).toThrow(TypeError);
    expect(ledger.entries(CASE_A)).toHaveLength(1);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
  });

  it("rejects malformed inputs", () => {
    expect(() => ledger.append(input({ caseId: "" }))).toThrow(/caseId/);
    expect(() => ledger.append(input({ epoch: -1 }))).toThrow(/epoch/);
    expect(() => ledger.append(input({ epoch: 1.5 }))).toThrow(/epoch/);
    expect(() => ledger.append(input({ type: "nope" as LedgerAppendInput["type"] }))).toThrow(
      /unknown event type/,
    );
    expect(() => ledger.append(input({ at: "" }))).toThrow(/at must be/);
    expect(() =>
      ledger.append(input({ payload: [] as unknown as Record<string, unknown> })),
    ).toThrow(/payload/);
    expect(() =>
      ledger.append(input({ payload: null as unknown as Record<string, unknown> })),
    ).toThrow(/payload/);
    expect(ledger.entries(CASE_A)).toEqual([]);
  });

  it("survives reopening the database file and keeps chaining from the last hash", () => {
    const before = seed(CASE_A, 3);
    ledger.close();
    ledger = openLedger(dbPath);
    expect(ledger.entries(CASE_A)).toEqual(before);
    const next = ledger.append(input({ type: "case_settled", epoch: 9, payload: { n: 4 } }));
    expect(next.seq).toBe(4);
    expect(next.prevHash).toBe(nth(before, 2).hash);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
  });

  it("works against an in-memory database (no file, same chaining rules)", () => {
    const mem = openLedger(":memory:");
    try {
      const one = mem.append(input({ type: "case_created", payload: { n: 1 } }));
      const two = mem.append(input({ type: "offer_recorded", payload: { n: 2 } }));
      expect(one.prevHash).toBe(GENESIS_HASH);
      expect(two.prevHash).toBe(one.hash);
      expect(mem.verifyChain(CASE_A)).toEqual({ ok: true });
    } finally {
      mem.close();
    }
  });
});

// ---------- verifyChain: intact ----------

describe("verifyChain on an intact chain", () => {
  it("returns ok with no broken sequence", () => {
    seed(CASE_A, 5);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
    expect(ledger.verifyChain(CASE_A).brokenAtSeq).toBeUndefined();
  });

  it("returns ok for a case that has no entries at all", () => {
    expect(ledger.verifyChain("cs_never_used")).toEqual({ ok: true });
  });
});

// ---------- verifyChain: tamper detection ----------

describe("verifyChain tamper detection", () => {
  it("detects a mutated payload in the middle of a chain", () => {
    const entries = seed(CASE_A, 5);
    const target = nth(entries, 2); // seq 3
    tamper((raw) => {
      raw
        .prepare("UPDATE ledger SET payload = ? WHERE seq = ?")
        .run(canonicalize({ round: 3, amountCents: 999_999, conditions: [] }), target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("detects a single flipped byte inside a payload string", () => {
    const entries = seed(CASE_A, 3);
    const target = nth(entries, 1); // seq 2
    tamper((raw) => {
      raw
        .prepare("UPDATE ledger SET payload = ? WHERE seq = ?")
        .run(canonicalize({ round: 2, amountCents: 2001, conditions: [] }), target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("detects a mutated epoch", () => {
    const entries = seed(CASE_A, 5);
    const target = nth(entries, 2);
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET epoch = epoch + 1 WHERE seq = ?").run(target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("detects a rewritten event type", () => {
    const entries = seed(CASE_A, 5);
    const target = nth(entries, 3); // seq 4, an offer_recorded
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET type = 'round_failed' WHERE seq = ?").run(target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("detects a back-dated timestamp", () => {
    const entries = seed(CASE_A, 4);
    const target = nth(entries, 1);
    tamper((raw) => {
      raw
        .prepare("UPDATE ledger SET at = '2020-01-01T00:00:00.000Z' WHERE seq = ?")
        .run(target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("detects a rewritten hash column even when the content is untouched", () => {
    const entries = seed(CASE_A, 4);
    const target = nth(entries, 2);
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET hash = ? WHERE seq = ?").run("a".repeat(64), target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("moves the break to the successor when the attacker also fixes the entry's own hash", () => {
    const entries = seed(CASE_A, 5);
    const target = nth(entries, 2); // seq 3
    const successor = nth(entries, 3); // seq 4
    const forgedPayload = { round: 3, amountCents: 1, conditions: [] };
    tamper((raw) => {
      const hash = computeEntryHash({
        seq: target.seq,
        caseId: target.caseId,
        epoch: target.epoch,
        type: target.type,
        payload: forgedPayload,
        at: target.at,
        prevHash: target.prevHash,
      });
      raw
        .prepare("UPDATE ledger SET payload = ?, hash = ? WHERE seq = ?")
        .run(canonicalize(forgedPayload), hash, target.seq);
    });
    // The entry itself now verifies; its successor's prevHash no longer matches.
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: successor.seq });
  });

  it("detects a deleted middle entry (the successor's link dangles)", () => {
    const entries = seed(CASE_A, 5);
    const deleted = nth(entries, 2); // seq 3
    const successor = nth(entries, 3); // seq 4
    tamper((raw) => {
      raw.prepare("DELETE FROM ledger WHERE seq = ?").run(deleted.seq);
    });
    expect(ledger.entries(CASE_A).map((e) => e.seq)).toEqual([1, 2, 4, 5]);
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: successor.seq });
  });

  it("detects two entries whose order was swapped", () => {
    const entries = seed(CASE_A, 4);
    const a = nth(entries, 1);
    const b = nth(entries, 2);
    tamper((raw) => {
      const swap = raw.prepare(
        "UPDATE ledger SET epoch = ?, type = ?, payload = ?, at = ?, hash = ?, prev_hash = ? WHERE seq = ?",
      );
      swap.run(b.epoch, b.type, canonicalize(b.payload), b.at, b.hash, b.prevHash, a.seq);
      swap.run(a.epoch, a.type, canonicalize(a.payload), a.at, a.hash, a.prevHash, b.seq);
    });
    // Row at seq 2 now carries entry 3's content, whose own hash covers seq 3.
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: a.seq });
  });

  it("does NOT detect truncation of the newest entry (the chain has no external anchor)", () => {
    const entries = seed(CASE_A, 5);
    const last = nth(entries, 4);
    tamper((raw) => {
      raw.prepare("DELETE FROM ledger WHERE seq = ?").run(last.seq);
    });
    // Honest documentation of the limit: hash chaining proves nothing was
    // *edited*, not that nothing was dropped from the tail. Detecting that
    // needs an anchor outside this table (published head hash / case record).
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
    expect(ledger.entries(CASE_A)).toHaveLength(4);
  });

  it("does NOT detect a full re-forge of the tail (same limit, stated once more)", () => {
    const entries = seed(CASE_A, 5);
    const target = nth(entries, 2);
    tamper((raw) => {
      const rows = raw
        .prepare("SELECT seq, case_id, epoch, type, payload, at FROM ledger WHERE case_id = ? ORDER BY seq ASC")
        .all(CASE_A) as Array<{
        seq: number;
        case_id: string;
        epoch: number;
        type: string;
        payload: string;
        at: string;
      }>;
      const update = raw.prepare("UPDATE ledger SET payload = ?, hash = ?, prev_hash = ? WHERE seq = ?");
      let prev = GENESIS_HASH;
      for (const row of rows) {
        const payload =
          row.seq === target.seq
            ? { round: 3, amountCents: 1, conditions: [] }
            : (JSON.parse(row.payload) as Record<string, unknown>);
        const hash = computeEntryHash({
          seq: row.seq,
          caseId: row.case_id,
          epoch: row.epoch,
          type: row.type as LedgerEntry["type"],
          payload,
          at: row.at,
          prevHash: prev,
        });
        update.run(canonicalize(payload), hash, prev, row.seq);
        prev = hash;
      }
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: true });
    // The forged value is what an unanchored verifier now reports as authentic.
    expect(nth(ledger.entries(CASE_A), 2).payload).toEqual({
      amountCents: 1,
      conditions: [],
      round: 3,
    });
  });

  it("scopes a break to the tampered case: a sibling case still verifies", () => {
    const a = seed(CASE_A, 3);
    const b = seed(CASE_B, 3);
    const target = nth(a, 1);
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET epoch = 4242 WHERE seq = ?").run(target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
    expect(ledger.verifyChain(CASE_B)).toEqual({ ok: true });
    expect(ledger.entries(CASE_B)).toEqual(b);
  });

  it("detects a genesis entry re-pointed away from GENESIS_HASH", () => {
    const entries = seed(CASE_A, 3);
    const first = nth(entries, 0);
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET prev_hash = ? WHERE seq = ?").run("b".repeat(64), first.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: first.seq });
  });

  it("detects an entry re-homed into another case", () => {
    seed(CASE_A, 3);
    const b = seed(CASE_B, 2);
    const stolen = nth(b, 1);
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET case_id = ? WHERE seq = ?").run(CASE_A, stolen.seq);
    });
    // Its hash commits to CASE_B and its prevHash links into CASE_B's chain.
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: stolen.seq });
  });

  it("detects corrupted (unparseable) payload JSON", () => {
    const entries = seed(CASE_A, 3);
    const target = nth(entries, 1);
    tamper((raw) => {
      raw.prepare("UPDATE ledger SET payload = '{not json' WHERE seq = ?").run(target.seq);
    });
    expect(ledger.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
  });

  it("property: mutating any single entry breaks the chain at exactly that entry", () => {
    let run = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 5000 }),
        (idx, delta) => {
          run += 1;
          const path = join(dir, `prop-${run}.db`); // fresh file per run
          const local = openLedger(path);
          const entries: LedgerEntry[] = [];
          try {
            for (let i = 1; i <= 5; i += 1) {
              entries.push(
                local.append(
                  input({
                    epoch: i,
                    type: i === 1 ? "case_created" : "offer_recorded",
                    payload: { i },
                  }),
                ),
              );
            }
            expect(local.verifyChain(CASE_A)).toEqual({ ok: true });
          } finally {
            local.close();
          }
          const target = nth(entries, idx);
          const raw = new Database(path);
          try {
            raw
              .prepare("UPDATE ledger SET payload = ? WHERE seq = ?")
              .run(canonicalize({ i: idx + 1 + delta }), target.seq);
          } finally {
            raw.close();
          }
          const reopened = openLedger(path);
          try {
            expect(reopened.verifyChain(CASE_A)).toEqual({ ok: false, brokenAtSeq: target.seq });
          } finally {
            reopened.close();
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import {
  CliUsageError,
  defaultDeps,
  parseAmountToCents,
  parseCliArgs,
  parseParty,
  runCli,
  sparkline,
  normalizePhrase,
  type CliDeps,
  type CliIo,
  type CliStore,
} from "../src/cli.js";
import type { CaseRecord, LedgerEntry, LedgerEventType } from "../src/types.js";

// ---------- Pure argument parsing ----------

describe("parseCliArgs", () => {
  it("parses the full open command", () => {
    const cmd = parseCliArgs([
      "open",
      "--vertical", "security_deposit",
      "--summary", "Deposit dispute over unit 4B",
      "--amount", "1200",
      "--party-a", "Landlord:+15550000001",
      "--party-b", "Tenant:+15550000002",
    ]);
    expect(cmd).toEqual({
      cmd: "open",
      db: "./caucus.db",
      vertical: "security_deposit",
      summary: "Deposit dispute over unit 4B",
      amountCents: 120_000,
      partyA: { label: "Landlord", phone: "+15550000001" },
      partyB: { label: "Tenant", phone: "+15550000002" },
      maxRounds: 8,
    });
  });

  it("honours --db overrides and decimal amounts", () => {
    const cmd = parseCliArgs([
      "open",
      "--db", "/tmp-x/alt.db",
      "--vertical", "unpaid_invoice",
      "--summary", "s",
      "--amount", "1200.50",
      "--party-a", "Acme LLC:+15550000003",
      "--party-b", "Contractor:+15550000004",
    ]);
    expect(cmd).toMatchObject({ db: "/tmp-x/alt.db", amountCents: 120_050 });
  });

  it("rejects malformed phones and amounts", () => {
    expect(() => parseParty("Landlord:555-0001", "--party-a")).toThrow(CliUsageError);
    expect(() => parseParty("+15550000001", "--party-a")).toThrow(CliUsageError);
    expect(() => parseAmountToCents("-5")).toThrow(CliUsageError);
    expect(() => parseAmountToCents("12.345")).toThrow(CliUsageError);
    expect(parseAmountToCents("12.5")).toBe(1_250);
  });

  it("keeps colons inside labels while splitting on the last one", () => {
    expect(parseParty("Sunrise: Unit 4B:+15550000009", "--party-a")).toEqual({
      label: "Sunrise: Unit 4B",
      phone: "+15550000009",
    });
  });

  it("parses run flags with safe defaults", () => {
    expect(parseCliArgs(["run", "cs_1"])).toEqual({
      cmd: "run", db: "./caucus.db", caseId: "cs_1",
      step: false, live: false, mock: false,
    });
    expect(parseCliArgs(["run", "cs_1", "--step", "--live"])).toMatchObject({
      step: true,
      live: true,
    });
  });

  it("parses status/verify/memo and rejects unknown commands", () => {
    expect(parseCliArgs(["status", "cs_2"])).toEqual({
      cmd: "status", db: "./caucus.db", caseId: "cs_2",
    });
    expect(parseCliArgs(["verify", "cs_2"])).toMatchObject({ cmd: "verify" });
    expect(parseCliArgs(["memo", "cs_2"])).toEqual({
      cmd: "memo", db: "./caucus.db", caseId: "cs_2", out: "memo.md",
    });
    expect(parseCliArgs([])).toEqual({ cmd: "help" });
    expect(() => parseCliArgs(["dial", "cs_2"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["status"])).toThrow(CliUsageError);
  });
});

describe("sparkline", () => {
  it("scales offers into party-tagged blocks", () => {
    const line = sparkline([
      { party: "A", amountCents: 100_000 },
      { party: "B", amountCents: 50_000 },
      { party: "A", amountCents: 75_000 },
    ]);
    expect(line).toBe("A█ B▁ A▅");
  });

  it("has a placeholder for empty curves", () => {
    expect(sparkline([])).toBe("(no offers yet)");
  });
});

describe("normalizePhrase", () => {
  it("compares attestation phrases case- and punctuation-insensitively", () => {
    expect(normalizePhrase("Amber, Falcon — NINE!")).toBe(
      normalizePhrase("amber falcon nine"),
    );
  });
});

// ---------- Integration: open + status against a temp sqlite db ----------

/**
 * Test-local store fixture implementing the CLI's `CliStore` surface on
 * better-sqlite3 (the real store module is owned by another workstream).
 */
function openTestStore(dbPath: string): CliStore {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (case_id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT NOT NULL, epoch INTEGER NOT NULL, type TEXT NOT NULL,
      payload TEXT NOT NULL, at TEXT NOT NULL, hash TEXT NOT NULL, prev_hash TEXT NOT NULL
    );
  `);
  const rowToEntry = (row: Record<string, unknown>): LedgerEntry => ({
    seq: row["seq"] as number,
    caseId: row["case_id"] as string,
    epoch: row["epoch"] as number,
    type: row["type"] as LedgerEventType,
    payload: JSON.parse(row["payload"] as string) as Record<string, unknown>,
    at: row["at"] as string,
    hash: row["hash"] as string,
    prevHash: row["prev_hash"] as string,
  });
  return {
    saveCase(rec: CaseRecord): void {
      db.prepare(
        `INSERT INTO cases (case_id, json) VALUES (?, ?)
         ON CONFLICT(case_id) DO UPDATE SET json = excluded.json`,
      ).run(rec.caseId, JSON.stringify(rec));
    },
    getCase(caseId: string): CaseRecord | undefined {
      const row = db
        .prepare("SELECT json FROM cases WHERE case_id = ?")
        .get(caseId) as { json: string } | undefined;
      return row === undefined ? undefined : (JSON.parse(row.json) as CaseRecord);
    },
    getLedger(caseId: string): LedgerEntry[] {
      const rows = db
        .prepare("SELECT * FROM ledger WHERE case_id = ? ORDER BY seq")
        .all(caseId) as Record<string, unknown>[];
      return rows.map(rowToEntry);
    },
    appendLedger(caseId, epoch, type, payload): LedgerEntry {
      const prev = db
        .prepare("SELECT hash FROM ledger WHERE case_id = ? ORDER BY seq DESC LIMIT 1")
        .get(caseId) as { hash: string } | undefined;
      const prevHash = prev?.hash ?? "genesis";
      const at = "2026-07-30T00:00:00.000Z";
      const hash = createHash("sha256")
        .update(prevHash + JSON.stringify({ caseId, epoch, type, payload, at }))
        .digest("hex");
      const info = db
        .prepare(
          `INSERT INTO ledger (case_id, epoch, type, payload, at, hash, prev_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(caseId, epoch, type, JSON.stringify(payload), at, hash, prevHash);
      return { seq: Number(info.lastInsertRowid), caseId, epoch, type, payload, at, hash, prevHash };
    },
    close(): void {
      db.close();
    },
  };
}

function captureIo(): CliIo & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  };
}

function testDeps(): CliDeps {
  return {
    openStore: (dbPath) => openTestStore(dbPath),
    makeClient: () => ({
      createAndWait: async () => {
        throw new Error("no calls expected in this test");
      },
    }),
    verifyChain: () => ({ ok: true }),
    runStep: async () => {
      throw new Error("runStep not exercised in this test");
    },
    now: () => "2026-07-30T00:00:00.000Z",
  };
}

describe("cli integration: open + status", () => {
  const dir = mkdtempSync(join(tmpdir(), "caucus-cli-"));
  const dbPath = join(dir, "caucus-test.db");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("open creates a case, writes a masked ledger entry, and prints the caseId", async () => {
    const io = captureIo();
    const code = await runCli(
      [
        "open",
        "--db", dbPath,
        "--vertical", "security_deposit",
        "--summary", "Deposit dispute over unit 4B",
        "--amount", "1200",
        "--party-a", "Landlord:+15550000001",
        "--party-b", "Tenant:+15550000002",
      ],
      io,
      testDeps(),
    );
    expect(code).toBe(0);

    const caseId = io.outLines[0];
    expect(caseId).toMatch(/^cs_/);
    // Consent-first messaging: no dialing implied by open.
    expect(io.outLines.join("\n")).toMatch(/no calls will be placed until both parties record consent/i);

    const store = openTestStore(dbPath);
    const rec = store.getCase(caseId!);
    expect(rec).toBeDefined();
    expect(rec).toMatchObject({
      state: "created",
      epoch: 0,
      rounds: [],
      dispute: {
        vertical: "security_deposit",
        amountCents: 120_000,
        currency: "USD",
      },
    });
    expect(rec?.parties.map((p) => p.id)).toEqual(["A", "B"]);
    expect(rec?.parties.map((p) => p.phone)).toEqual([
      "+15550000001",
      "+15550000002",
    ]);

    const ledger = store.getLedger(caseId!);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.type).toBe("case_created");
    // POLICY CHANGE, deliberate: the genesis is the canonical one from
    // genesisEvent(), which carries full E.164 numbers. The ledger is the
    // single source of truth — a case rehydrated from a masked genesis could
    // never dial its parties (the original masked genesis here was exactly
    // that bug). The local case db is private; masking is an EXPORT property,
    // asserted where exports are made (memo, dashboard, static replay tests).
    const payloadJson = JSON.stringify(ledger[0]?.payload);
    expect(payloadJson).toContain("+15550000001");
    // ...and the ledger alone reproduces a dialable case.
    const { rehydrate } = await import("../src/state.js");
    const replayed = rehydrate(caseId!, ledger);
    expect(replayed.parties.map((p) => p.phone)).toEqual(["+15550000001", "+15550000002"]);
    expect(replayed.state).toBe("created");
    store.close();
  });

  it("status renders state, round count, and an empty-curve placeholder", async () => {
    const openIo = captureIo();
    await runCli(
      [
        "open",
        "--db", dbPath,
        "--vertical", "unpaid_invoice",
        "--summary", "Invoice 1042 partially disputed",
        "--amount", "800",
        "--party-a", "Acme LLC:+15550000003",
        "--party-b", "Contractor:+15550000004",
      ],
      openIo,
      testDeps(),
    );
    const caseId = openIo.outLines[0]!;

    const io = captureIo();
    const code = await runCli(["status", caseId, "--db", dbPath], io, testDeps());
    expect(code).toBe(0);
    const out = io.outLines.join("\n");
    expect(out).toContain(`case:    ${caseId}`);
    expect(out).toContain("state:   created");
    expect(out).toContain("dispute: Invoice 1042 partially disputed");
    expect(out).toContain("amount:  $800.00 USD");
    expect(out).toContain("rounds:  0/8");
    expect(out).toContain("curve:   (no offers yet)");
  });

  it("status exits 1 for an unknown case", async () => {
    const io = captureIo();
    const code = await runCli(["status", "cs_missing", "--db", dbPath], io, testDeps());
    expect(code).toBe(1);
    expect(io.errLines.join("\n")).toContain("no such case");
  });

  it("run --live without CALLE_API_KEY is refused before any store access", async () => {
    const saved = process.env["CALLE_API_KEY"];
    delete process.env["CALLE_API_KEY"];
    try {
      const io = captureIo();
      const code = await runCli(
        ["run", "cs_any", "--db", dbPath, "--step", "--live"],
        io,
        testDeps(),
      );
      expect(code).toBe(1);
      expect(io.errLines.join("\n")).toContain("refusing --live");
    } finally {
      if (saved !== undefined) process.env["CALLE_API_KEY"] = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// Default wiring — the production deps, no injection.
//
// Regression guard for a class of bug the injected-deps tests can never see:
// the CLI once resolved its collaborators with dynamic imports and guessed
// export names, and had NEVER worked from a real terminal (missing ./store.js,
// wrong calle factory names, runStep sought in the wrong module, a masked
// genesis rehydration could not dial from, and a ledger-silent tick that made
// each fresh process repeat the same step forever). All 558 tests were green
// the whole time. This suite drives the DOCUMENTED commands through
// defaultDeps() end to end, exactly as a user would.
// ---------------------------------------------------------------------------
describe("cli default wiring (production deps, mock client)", () => {
  it("open -> run --step xN -> settled -> verify PASS -> memo, from a real db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "caucus-cli-default-"));
    const db = join(dir, "case.db");
    try {
      const openIo = captureIo();
      const openCode = await runCli(
        [
          "open", "--db", db,
          "--vertical", "security-deposit",
          "--summary", "Disputed deductions from a residential security deposit.",
          "--amount", "1200",
          "--party-a", "the landlord:+15550000001",
          "--party-b", "the tenant:+15550000002",
        ],
        openIo,
        defaultDeps(),
      );
      expect(openCode).toBe(0);
      const caseId = openIo.outLines[0];
      expect(caseId).toMatch(/^cs_/);

      // Six real steps: 2 consents, open, accept, 2 attestations. A bounded
      // loop rather than exactly six, so a policy tweak fails loudly not flakily.
      let settled = false;
      for (let i = 0; i < 10 && !settled; i += 1) {
        const io = captureIo();
        expect(await runCli(["run", caseId!, "--db", db, "--step"], io, defaultDeps())).toBe(0);
        settled = io.outLines.some((l) => l.includes("settled"));
      }
      expect(settled).toBe(true);

      const verifyIo = captureIo();
      expect(await runCli(["verify", caseId!, "--db", db], verifyIo, defaultDeps())).toBe(0);
      expect(verifyIo.outLines.join("\n")).toContain("verify: PASS");

      const memoPath = join(dir, "memo.md");
      const memoIo = captureIo();
      expect(await runCli(["memo", caseId!, "--db", db, "--out", memoPath], memoIo, defaultDeps())).toBe(0);
      const memo = await import("node:fs").then((fs) => fs.readFileSync(memoPath, "utf8"));
      expect(memo).toContain("settled");
      expect(memo).not.toContain("+15550000001"); // memo masks; the ledger does not
      expect(memo).toContain("***0001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

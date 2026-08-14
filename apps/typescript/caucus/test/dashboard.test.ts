/**
 * Operator dashboard tests.
 *
 * The fixture is a REAL settled case: driven through the production runner,
 * state machine, renderer, and hash-chained sqlite ledger, with only the phone
 * network mocked (scripted personas). The dashboard is then pointed at that
 * ledger the same way an operator would point it at one.
 *
 * Privacy is asserted with sentinel strings: distinctive tokens are planted in
 * each party's private intake data, and the serialized view payload is checked
 * to contain neither them nor any unmasked phone number.
 *
 * All phone numbers are fictional (+1555…) per repository convention.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { CaseRecord, LedgerEntry, Party, RenderedCall } from "../src/types.js";
import {
  agreeableLandlord,
  MockCalleClient,
  stubbornTenant,
  type MockScript,
} from "../src/calle.js";
import { openLedger } from "../src/ledger.js";
import { createCase, genesisEvent } from "../src/state.js";
import { runCase } from "../src/runner.js";
import {
  buildCaseView,
  exportStatic,
  startDashboard,
  verifyEntriesChain,
  type CaseList,
  type CaseView,
  type DashboardServer,
} from "../src/dashboard.js";

const LANDLORD_PHONE = "+15550000001";
const TENANT_PHONE = "+15550000002";

/** Distinctive private data that must never surface in any view payload. */
const LANDLORD_SECRET = "ZEPHYRQUARTZ would settle at four hundred if pushed";
const TENANT_SECRET = "MARMALADEHELIX cannot afford court filing fees";

function parties(): [Party, Party] {
  return [
    {
      id: "A",
      label: "the landlord",
      phone: LANDLORD_PHONE,
      private: { reservationCents: 40_000, notes: LANDLORD_SECRET },
    },
    {
      id: "B",
      label: "the tenant",
      phone: TENANT_PHONE,
      private: { reservationCents: 55_000, notes: TENANT_SECRET },
    },
  ];
}

function depositCase(caseId: string): CaseRecord {
  return createCase(
    {
      caseId,
      dispute: {
        vertical: "security_deposit",
        summary:
          "Withheld portion of a residential security deposit after move-out, disputed carpet damage.",
        amountCents: 120_000,
        currency: "USD",
      },
      parties: parties(),
      policy: {
        maxRounds: 8,
        coolingOffMinutes: 0,
        callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
        retryDelaysMinutes: [],
        ttlHours: 72,
      },
    },
    "2026-08-01T15:00:00.000Z",
  );
}

function twoPartyScript(): MockScript {
  const landlord = agreeableLandlord(400, 700);
  const tenant = stubbornTenant(1200);
  return {
    matchers: [
      { when: (r: RenderedCall) => r.callee === "A", respond: (r) => landlord.default!(r) },
      { when: (r: RenderedCall) => r.callee === "B", respond: (r) => tenant.default!(r) },
    ],
  };
}

function stepClock(startIso = "2026-08-01T15:00:00.000Z"): () => string {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += 60_000;
    return iso;
  };
}

interface Fixture {
  dir: string;
  dbPath: string;
  caseId: string;
  final: CaseRecord;
  entries: LedgerEntry[];
}

/** Drive a full case (consent -> shuttle rounds -> dual attestation) against a real ledger. */
async function settledFixture(caseId: string): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "caucus-dash-"));
  const dbPath = join(dir, "ledger.db");
  const ledger = openLedger(dbPath);
  try {
    const rec = depositCase(caseId);
    const genesis = genesisEvent(rec);
    ledger.append({
      caseId: rec.caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });
    const client = new MockCalleClient(twoPartyScript());
    const { rec: final, finished } = await runCase({
      rec,
      client,
      ledger,
      maxSteps: 40,
      clock: stepClock(),
    });
    expect(finished).toBe(true);
    expect(final.state).toBe("settled");
    return { dir, dbPath, caseId, final, entries: ledger.entries(caseId) };
  } finally {
    ledger.close();
  }
}

// ---------------------------------------------------------------------------
// buildCaseView
// ---------------------------------------------------------------------------

describe("buildCaseView", () => {
  let fx: Fixture;
  let view: CaseView;
  let json: string;

  beforeAll(async () => {
    fx = await settledFixture("case_dash_view");
    view = buildCaseView(fx.final, fx.entries);
    json = JSON.stringify(view);
  });

  afterAll(() => {
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it("masks phone numbers to their last four digits everywhere", () => {
    const masked = Object.fromEntries(view.parties.map((p) => [p.id, p.phoneMasked]));
    expect(masked).toEqual({ A: "***0001", B: "***0002" });
    // No unmasked number anywhere in the serialized payload.
    expect(json).not.toContain(LANDLORD_PHONE);
    expect(json).not.toContain(TENANT_PHONE);
    expect(json).not.toContain("5550000001");
    expect(json).not.toContain("5550000002");
  });

  it("never contains party-private intake data or the ZOPA derived from it", () => {
    expect(json).not.toContain("ZEPHYRQUARTZ");
    expect(json).not.toContain("MARMALADEHELIX");
    // The private field names themselves must not appear — the payload is
    // built by explicit allowlist, never by spreading a Party object.
    expect(json).not.toContain("reservationCents");
    expect(json).not.toContain('"notes"');
    expect(json).not.toContain('"private"');
    // assess() derives the ZOPA from private reservation bounds; it is
    // deliberately stripped before the payload leaves the process.
    expect(json).not.toContain("zopa");
  });

  it("has concession-curve points for both parties, in round order", () => {
    const partiesSeen = new Set(view.curve.map((p) => p.party));
    expect(partiesSeen).toEqual(new Set(["A", "B"]));
    const rounds = view.curve.map((p) => p.round);
    expect([...rounds].sort((a, b) => a - b)).toEqual(rounds);
    for (const p of view.curve) {
      const round = view.rounds.find((r) => r.round === p.round);
      expect(round?.amountCents).toBe(p.amountCents);
    }
  });

  it("renders each round with party label, kind, amount, evidence and callId", () => {
    expect(view.rounds.length).toBeGreaterThanOrEqual(2);
    expect(view.rounds.map((r) => r.round)).toEqual(view.rounds.map((_, i) => i + 1));
    for (const r of view.rounds) {
      expect(["A", "B"]).toContain(r.party);
      expect(r.partyLabel).toBe(r.party === "A" ? "the landlord" : "the tenant");
      expect(r.callId).toMatch(/^mock_/);
    }
    // The scripted personas cite transcript quotes on every offer round.
    const offerRounds = view.rounds.filter((r) => r.kind !== null);
    expect(offerRounds.length).toBeGreaterThan(0);
    for (const r of offerRounds) expect(r.evidence.length).toBeGreaterThan(0);
    expect(view.rounds.at(-1)?.kind).toBe("accept");
  });

  it("surfaces consent call ids for both parties", () => {
    expect(view.consent.A).toMatch(/^mock_/);
    expect(view.consent.B).toMatch(/^mock_/);
    expect(view.consent.A).not.toBe(view.consent.B);
  });

  it("carries settlement terms, digest, phrase, and both attestations", () => {
    const s = view.settlement;
    expect(s).not.toBeNull();
    expect(s!.amountCents).toBe(fx.final.settlement!.amountCents);
    expect(s!.termsDigest).toBe(fx.final.settlement!.termsDigest);
    expect(s!.attestationPhrase).toMatch(/^\d{6}$/);
    expect(s!.attestations.map((a) => a.party).sort()).toEqual(["A", "B"]);
    for (const att of s!.attestations) {
      expect(att.verified).toBe(true);
      expect(att.callId).toMatch(/^mock_/);
    }
    const [a, b] = s!.attestations;
    expect(a!.callId).not.toBe(b!.callId);
  });

  it("surfaces ledger chain status computed from the entries themselves", () => {
    expect(view.ledger.entries).toBe(fx.entries.length);
    expect(view.ledger.chainOk).toBe(true);
    expect(view.ledger.brokenAtSeq).toBeNull();
    expect(view.ledger.headHash).toBe(fx.entries.at(-1)!.hash);
  });

  it("reports a broken chain when an entry payload is tampered with", () => {
    const tampered: LedgerEntry[] = fx.entries.map((e) => ({
      ...e,
      payload: { ...e.payload },
    }));
    const victim = tampered.find((e) => e.type === "offer_recorded")!;
    victim.payload["forged"] = true;
    const tv = buildCaseView(fx.final, tampered);
    expect(tv.ledger.chainOk).toBe(false);
    expect(tv.ledger.brokenAtSeq).toBe(victim.seq);
    // The pure verifier agrees.
    expect(verifyEntriesChain(fx.caseId, tampered)).toEqual({ ok: false, brokenAtSeq: victim.seq });
    expect(verifyEntriesChain(fx.caseId, fx.entries)).toEqual({ ok: true });
  });

  it("ignores ledger entries that belong to other cases", () => {
    const foreign: LedgerEntry = {
      seq: 999_999,
      caseId: "case_other",
      epoch: 0,
      type: "case_created",
      payload: { caseId: "case_other" },
      at: "2026-08-01T15:00:00.000Z",
      hash: "f".repeat(64),
      prevHash: "0".repeat(64),
    };
    const withForeign = buildCaseView(fx.final, [...fx.entries, foreign]);
    expect(withForeign.ledger.entries).toBe(fx.entries.length);
    expect(withForeign.ledger.chainOk).toBe(true);
  });

  it("is deterministic: identical inputs produce byte-identical JSON", () => {
    expect(JSON.stringify(buildCaseView(fx.final, fx.entries))).toBe(json);
  });
});

// ---------------------------------------------------------------------------
// startDashboard (node:http server)
// ---------------------------------------------------------------------------

describe("startDashboard", () => {
  let fx: Fixture;
  let server: DashboardServer | null = null;

  beforeAll(async () => {
    fx = await settledFixture("case_dash_http");
  });

  afterAll(() => {
    rmSync(fx.dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    if (server !== null) await server.close();
    server = null;
  });

  async function start(): Promise<DashboardServer> {
    server = await startDashboard({ dbPath: fx.dbPath, port: 0 });
    return server;
  }

  it("serves the frontend assets with correct content types", async () => {
    const { url } = await start();
    const expectations: [string, string][] = [
      ["", "text/html"],
      ["index.html", "text/html"],
      ["app.js", "text/javascript"],
      ["styles.css", "text/css"],
    ];
    for (const [path, type] of expectations) {
      const res = await fetch(url + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain(type);
      expect((await res.text()).length).toBeGreaterThan(0);
    }
  });

  it("serves the case list at /cases.json and /api/cases with hrefs into the API", async () => {
    const { url } = await start();
    for (const path of ["cases.json", "api/cases"]) {
      const res = await fetch(url + path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const list = (await res.json()) as CaseList;
      expect(list.kind).toBe("caucus_case_list");
      expect(list.cases).toHaveLength(1);
      expect(list.cases[0]!.caseId).toBe(fx.caseId);
      expect(list.cases[0]!.state).toBe("settled");
      expect(list.cases[0]!.href).toBe(`api/cases/${fx.caseId}`);
    }
  });

  it("serves the CaseView payload for a case, identical to buildCaseView", async () => {
    const { url } = await start();
    const res = await fetch(`${url}api/cases/${fx.caseId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as CaseView;
    expect(body).toEqual(JSON.parse(JSON.stringify(buildCaseView(fx.final, fx.entries))));
  });

  it("keeps private data and full phone numbers out of every HTTP response", async () => {
    const { url } = await start();
    for (const path of ["cases.json", `api/cases/${fx.caseId}`]) {
      const text = await (await fetch(url + path)).text();
      expect(text).not.toContain("ZEPHYRQUARTZ");
      expect(text).not.toContain("MARMALADEHELIX");
      expect(text).not.toContain("5550000001");
      expect(text).not.toContain("5550000002");
      expect(text).not.toContain("reservationCents");
    }
  });

  it("responds 404 for unknown routes and unknown cases", async () => {
    const { url } = await start();
    for (const path of ["nope", "api/cases/does_not_exist", "api/nope"]) {
      const res = await fetch(url + path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("responds 405 to non-GET methods", async () => {
    const { url } = await start();
    const res = await fetch(url, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("close() is idempotent", async () => {
    const s = await start();
    await s.close();
    await s.close();
    server = null;
  });
});

// ---------------------------------------------------------------------------
// exportStatic
// ---------------------------------------------------------------------------

describe("exportStatic", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await settledFixture("case_dash_static");
  });

  afterAll(() => {
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it("writes a self-contained folder: frontend files + case.json + cases.json", () => {
    const outDir = join(fx.dir, "site");
    const result = exportStatic({ dbPath: fx.dbPath, caseId: fx.caseId, outDir });
    expect(result.outDir).toBe(outDir);
    expect([...result.files].sort()).toEqual(
      ["app.js", "case.json", "cases.json", "index.html", "styles.css"].sort(),
    );
    const onDisk = readdirSync(outDir).sort();
    expect(onDisk).toEqual(["app.js", "case.json", "cases.json", "index.html", "styles.css"]);

    // case.json parses to the same CaseView the live server would serve.
    const view = JSON.parse(readFileSync(join(outDir, "case.json"), "utf8")) as CaseView;
    expect(view.kind).toBe("caucus_case_view");
    expect(view.caseId).toBe(fx.caseId);
    expect(view.state).toBe("settled");
    expect(view).toEqual(JSON.parse(JSON.stringify(buildCaseView(fx.final, fx.entries))));

    // cases.json points the dual-purpose frontend at the local file, not an API.
    const list = JSON.parse(readFileSync(join(outDir, "cases.json"), "utf8")) as CaseList;
    expect(list.kind).toBe("caucus_case_list");
    expect(list.cases).toHaveLength(1);
    expect(list.cases[0]!.href).toBe("case.json");

    // The exported HTML keeps its relative references (no absolute paths).
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('src="app.js"');
    expect(html).toContain('href="styles.css"');
    // And the exported frontend fetches the relative payload it sits next to.
    const appJs = readFileSync(join(outDir, "app.js"), "utf8");
    expect(appJs).toContain('"cases.json"');
  });

  it("keeps private data and full phone numbers out of every exported file", () => {
    const outDir = join(fx.dir, "site-privacy");
    exportStatic({ dbPath: fx.dbPath, caseId: fx.caseId, outDir });
    for (const name of readdirSync(outDir)) {
      const text = readFileSync(join(outDir, name), "utf8");
      expect(text, name).not.toContain("ZEPHYRQUARTZ");
      expect(text, name).not.toContain("MARMALADEHELIX");
      expect(text, name).not.toContain("5550000001");
      expect(text, name).not.toContain("5550000002");
    }
  });

  it("throws loudly for a case the ledger does not contain", () => {
    expect(() =>
      exportStatic({ dbPath: fx.dbPath, caseId: "case_missing", outDir: join(fx.dir, "site-missing") }),
    ).toThrow(/no ledger entries/);
  });
});

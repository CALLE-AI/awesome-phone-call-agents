/**
 * Verticals: a dispute type is DATA, not code.
 *
 * The load-bearing test here is the generalization proof: the SAME engine
 * (runner, state machine, taint-checking renderer, attestation crypto, ledger)
 * drives a full mock case to "settled" in the unpaid-invoice vertical — and in
 * a vertical INVENTED inside this file that no source module has ever seen —
 * from config alone, with zero code changes. This is the direct defense against
 * "it's a hardcoded demo script".
 *
 * All phone numbers here are fictional (+1555…) per repository convention.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RenderedCall } from "../src/types.js";
import {
  agreeableLandlord,
  MockCalleClient,
  stubbornTenant,
  type MockScript,
} from "../src/calle.js";
import { openLedger, type Ledger } from "../src/ledger.js";
import { createCase, genesisEvent, rehydrate } from "../src/state.js";
import { runCase } from "../src/runner.js";
import { verifySpokenPhrase } from "../src/attest.js";
import {
  caseInputForVertical,
  defaultSummary,
  listVerticalIds,
  listVerticals,
  loadVertical,
  validateVertical,
  VerticalConfigError,
  type VerticalCaseParams,
} from "../src/verticals.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic clock: one minute per step (same shape as test/e2e.test.ts). */
function stepClock(startIso: string): () => string {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += 60_000;
    return iso;
  };
}

/** Route one persona to each party so a single mock client serves both sides. */
function routed(a: MockScript, b: MockScript): MockScript {
  return {
    matchers: [
      { when: (r: RenderedCall) => r.callee === "A", respond: (r) => a.default!(r) },
      { when: (r: RenderedCall) => r.callee === "B", respond: (r) => b.default!(r) },
    ],
  };
}

/** A fully valid config for a vertical that exists nowhere in the source tree. */
function inventedConfig(): Record<string, unknown> {
  return {
    id: "gym-membership-refund",
    displayName: "Gym membership refund",
    disputeNoun: "membership refund",
    partyRoles: {
      A: {
        label: "the member",
        description: "Paid for a membership and is owed the disputed refund.",
      },
      B: {
        label: "the gym operator",
        description: "Collected the fees and disputes the refund owed.",
      },
    },
    defaultPolicy: {
      maxRounds: 8,
      coolingOffMinutes: 30,
      callWindow: { startHour: 9, endHour: 18, timezone: "America/Denver" },
      retryDelaysMinutes: [30, 120],
      ttlHours: 96,
    },
    suggestedConditions: ["operator confirms the cancellation date in writing"],
    guidance: { shuttle: "Keep the discussion on billed months and the cancellation record." },
  };
}

function catchVerticalError(fn: () => unknown): VerticalConfigError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(VerticalConfigError);
    return err as VerticalConfigError;
  }
  throw new Error("expected a VerticalConfigError, but nothing was thrown");
}

// ---------------------------------------------------------------------------
// Shipped configs
// ---------------------------------------------------------------------------

describe("shipped vertical configs", () => {
  it("ships exactly the three advertised verticals", () => {
    expect(listVerticalIds()).toEqual([
      "freight-detention",
      "security-deposit",
      "unpaid-invoice",
    ]);
  });

  it("every shipped config loads, validates, and has sane business defaults", () => {
    const all = listVerticals();
    expect(all.map((v) => v.id)).toEqual([
      "freight-detention",
      "security-deposit",
      "unpaid-invoice",
    ]);
    for (const v of all) {
      expect(v.displayName.length).toBeGreaterThan(0);
      expect(v.disputeNoun.length).toBeGreaterThan(0);
      expect(v.partyRoles.A.label).not.toBe(v.partyRoles.B.label);
      for (const role of [v.partyRoles.A, v.partyRoles.B]) {
        expect(role.label.startsWith("the ")).toBe(true);
        expect(role.description.length).toBeGreaterThan(0);
      }
      const p = v.defaultPolicy;
      expect(p.maxRounds).toBeGreaterThanOrEqual(1);
      // Business-hours dialing windows: never before 07:00, never after 20:00.
      expect(p.callWindow.startHour).toBeGreaterThanOrEqual(7);
      expect(p.callWindow.endHour).toBeLessThanOrEqual(20);
      expect(p.callWindow.startHour).toBeLessThan(p.callWindow.endHour);
      // The timezone must exist in the runtime's IANA database.
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: p.callWindow.timezone })).not.toThrow();
      // Retry ladders back off (strictly increasing delays).
      for (let i = 1; i < p.retryDelaysMinutes.length; i += 1) {
        expect(p.retryDelaysMinutes[i]!).toBeGreaterThan(p.retryDelaysMinutes[i - 1]!);
      }
      expect(p.ttlHours).toBeGreaterThan(0);
      expect(v.suggestedConditions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("pins the role pairs the voice agent speaks", () => {
    const roleLabels = (id: string) => {
      const v = loadVertical(id);
      return [v.partyRoles.A.label, v.partyRoles.B.label];
    };
    expect(roleLabels("security-deposit")).toEqual(["the landlord", "the tenant"]);
    expect(roleLabels("unpaid-invoice")).toEqual(["the supplier", "the customer"]);
    expect(roleLabels("freight-detention")).toEqual(["the broker", "the carrier"]);
  });

  it("no engine module mentions any vertical id — the engine cannot branch on it", () => {
    // The whole point of verticals-as-data: state machine, renderer, runner,
    // engine, attestation, ledger, and the call layer are vertical-blind.
    const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
    const engineFiles = [
      "state.ts",
      "renderer.ts",
      "runner.ts",
      "engine.ts",
      "attest.ts",
      "ledger.ts",
      "calle.ts",
      "schemas.ts",
    ];
    for (const file of engineFiles) {
      const source = readFileSync(join(srcDir, file), "utf8");
      for (const id of listVerticalIds()) {
        expect(source, `${file} must not special-case vertical "${id}"`).not.toContain(id);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// validateVertical
// ---------------------------------------------------------------------------

describe("validateVertical", () => {
  it("returns a faithful, defensively-copied config for valid input", () => {
    const raw = inventedConfig();
    const parsed = validateVertical(raw);
    expect(parsed).toEqual(raw);
    // Mutating the parsed arrays must not reach back into the caller's object.
    parsed.suggestedConditions.push("mutated");
    parsed.defaultPolicy.retryDelaysMinutes.push(999);
    expect((raw as { suggestedConditions: string[] }).suggestedConditions).toHaveLength(1);
    expect(
      (raw as { defaultPolicy: { retryDelaysMinutes: number[] } }).defaultPolicy
        .retryDelaysMinutes,
    ).toEqual([30, 120]);
  });

  it("rejects a malformed config with every problem and its config path", () => {
    const cfg = inventedConfig() as {
      partyRoles: { A: unknown; B?: unknown };
      defaultPolicy: { maxRounds: number; callWindow: { startHour: number } };
    };
    cfg.defaultPolicy.callWindow.startHour = 26; // out of range
    cfg.defaultPolicy.maxRounds = 0; // below minimum
    delete cfg.partyRoles.B; // missing role
    const err = catchVerticalError(() => validateVertical(cfg, "test fixture"));
    expect(err.source).toBe("test fixture");
    expect(err.issues.length).toBeGreaterThanOrEqual(3);
    expect(err.message).toContain("defaultPolicy.callWindow.startHour");
    expect(err.message).toContain("defaultPolicy.maxRounds");
    expect(err.message).toContain("partyRoles.B");
  });

  it("rejects unknown keys, so a typo never passes silently", () => {
    const cfg = inventedConfig();
    (cfg as Record<string, unknown>)["surpriseKey"] = true;
    const err = catchVerticalError(() => validateVertical(cfg));
    expect(err.message).toContain("surpriseKey");
  });

  it("rejects a timezone the runtime's IANA database does not know", () => {
    const cfg = inventedConfig() as {
      defaultPolicy: { callWindow: { timezone: string } };
    };
    cfg.defaultPolicy.callWindow.timezone = "Mars/Olympus";
    const err = catchVerticalError(() => validateVertical(cfg));
    expect(err.message).toContain("IANA");
    expect(err.message).toContain("defaultPolicy.callWindow.timezone");
  });

  it("rejects an empty (undialable) call window", () => {
    const cfg = inventedConfig() as {
      defaultPolicy: { callWindow: { startHour: number; endHour: number } };
    };
    cfg.defaultPolicy.callWindow.startHour = 9;
    cfg.defaultPolicy.callWindow.endHour = 9;
    const err = catchVerticalError(() => validateVertical(cfg));
    expect(err.message).toContain("must differ");
  });
});

// ---------------------------------------------------------------------------
// loadVertical / listVerticalIds against a caller-supplied directory
// ---------------------------------------------------------------------------

describe("loadVertical", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "caucus-verticals-"));
    writeFileSync(join(dir, "gym-membership-refund.json"), JSON.stringify(inventedConfig()));
    // id inside says "gym-membership-refund" but the filename disagrees:
    writeFileSync(join(dir, "mismatched.json"), JSON.stringify(inventedConfig()));
    writeFileSync(join(dir, "broken.json"), "{ this is not json");
    writeFileSync(join(dir, "Bad Name.json"), JSON.stringify(inventedConfig()));
    writeFileSync(join(dir, "notes.txt"), "not a config");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a valid config from a caller-supplied directory", () => {
    const v = loadVertical("gym-membership-refund", dir);
    expect(v.displayName).toBe("Gym membership refund");
    expect(v.partyRoles.A.label).toBe("the member");
    expect(v.guidance?.shuttle).toContain("cancellation record");
  });

  it("rejects a non-kebab id before touching the filesystem", () => {
    for (const bad of ["../secrets", "UPPER", "spaced id", ""]) {
      expect(() => loadVertical(bad, dir)).toThrow(/kebab-case/);
    }
  });

  it("names the available verticals when the id does not exist", () => {
    const err = catchVerticalError(() => loadVertical("no-such-vertical", dir));
    expect(err.message).toContain('no such vertical "no-such-vertical"');
    expect(err.message).toContain("gym-membership-refund");
    // And against the shipped directory:
    const shipped = catchVerticalError(() => loadVertical("no-such-vertical"));
    expect(shipped.message).toContain("security-deposit");
  });

  it("reports unparseable JSON with the offending file path", () => {
    const err = catchVerticalError(() => loadVertical("broken", dir));
    expect(err.message).toContain("broken.json");
    expect(err.message).toContain("not valid JSON");
  });

  it("reports an id/filename mismatch as the copy-paste bug it is", () => {
    const err = catchVerticalError(() => loadVertical("mismatched", dir));
    expect(err.message).toContain('config id "gym-membership-refund"');
    expect(err.message).toContain('does not match filename id "mismatched"');
  });

  it("ignores files whose names are not well-formed vertical ids", () => {
    expect(listVerticalIds(dir)).toEqual(["broken", "gym-membership-refund", "mismatched"]);
  });
});

// ---------------------------------------------------------------------------
// caseInputForVertical
// ---------------------------------------------------------------------------

describe("caseInputForVertical", () => {
  const config = loadVertical("unpaid-invoice");

  const params = (): VerticalCaseParams => ({
    caseId: "case_invoice_input",
    amountCents: 480_000,
    partyA: { name: "Priya Raman", phone: "+15550000021" },
    partyB: { name: "Marcus Webb", phone: "+15550000022" },
  });

  it("builds a complete CreateCaseInput from config plus case facts", () => {
    const input = caseInputForVertical(config, params());
    expect(input.caseId).toBe("case_invoice_input");
    expect(input.dispute.vertical).toBe("unpaid-invoice");
    expect(input.dispute.amountCents).toBe(480_000);
    expect(input.dispute.currency).toBe("USD");
    expect(input.dispute.summary).toBe(defaultSummary(config, 480_000));
    expect(input.dispute.summary).toContain("unpaid invoice");
    expect(input.dispute.summary).toContain("$4,800");
    expect(input.dispute.summary).toContain("the supplier");
    expect(input.dispute.summary).toContain("the customer");
    expect(input.parties[0]).toEqual({
      id: "A",
      label: "Priya Raman (the supplier)",
      phone: "+15550000021",
      private: {},
    });
    expect(input.parties[1].label).toBe("Marcus Webb (the customer)");
    expect(input.policy).toEqual(config.defaultPolicy);
    expect(input.policy).not.toBe(config.defaultPolicy); // a copy, not a shared reference
  });

  it("accepts overrides for summary, policy fields, and private intake data", () => {
    const input = caseInputForVertical(config, {
      ...params(),
      summary: "Disputed balance on invoice INV-2207 for the June produce order.",
      policy: { coolingOffMinutes: 0 },
      partyA: {
        name: "Priya Raman",
        phone: "+15550000021",
        private: { reservationCents: 200_000, notes: "would take less to keep the account" },
      },
      partyB: { name: "Marcus Webb", phone: "+15550000022" },
    });
    expect(input.dispute.summary).toContain("INV-2207");
    expect(input.policy.coolingOffMinutes).toBe(0);
    expect(input.policy.maxRounds).toBe(config.defaultPolicy.maxRounds); // untouched fields survive
    expect(input.parties[0].private).toEqual({
      reservationCents: 200_000,
      notes: "would take less to keep the account",
    });
  });

  it("lists every problem with bad case facts in one error", () => {
    const err = catchVerticalError(() =>
      caseInputForVertical(config, {
        caseId: "",
        amountCents: 0,
        partyA: { name: "  ", phone: "+15550000021" },
        partyB: { name: "Marcus Webb", phone: "555-0001" },
      }),
    );
    expect(err.issues.length).toBeGreaterThanOrEqual(4);
    expect(err.message).toContain("caseId must be non-empty");
    expect(err.message).toContain("amountCents must be a positive integer");
    expect(err.message).toContain("party A: name must be non-empty");
    expect(err.message).toContain("party B: phone must be E.164");
  });

  it("rejects two parties sharing one phone number", () => {
    const p = params();
    p.partyB.phone = p.partyA.phone;
    const err = catchVerticalError(() => caseInputForVertical(config, p));
    expect(err.message).toContain("distinct phone numbers");
  });

  it("feeds createCase directly — opening a case in a vertical is one call", () => {
    const rec = createCase(caseInputForVertical(config, params()), "2026-08-03T16:00:00.000Z");
    expect(rec.state).toBe("created");
    expect(rec.dispute.vertical).toBe("unpaid-invoice");
    expect(rec.policy).toEqual(config.defaultPolicy);
  });
});

// ---------------------------------------------------------------------------
// THE generalization proof
// ---------------------------------------------------------------------------

describe("generalization proof — the same engine settles other verticals from config alone", () => {
  let dir: string;
  let ledger: Ledger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "caucus-vertical-e2e-"));
    ledger = openLedger(join(dir, "case.db"));
  });

  afterEach(() => {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const SUPPLIER_SECRET = "AURELIANMANIFEST would settle at two thousand to keep the account";
  const CUSTOMER_SECRET = "COBALTLEDGERFERN has cash-flow trouble until September";
  const SUPPLIER_PHONE = "+15550000021";
  const CUSTOMER_PHONE = "+15550000022";

  it("unpaid-invoice (B2B): a full mock case reaches settled using ONLY the shipped config", async () => {
    const config = loadVertical("unpaid-invoice");
    const rec = createCase(
      caseInputForVertical(config, {
        caseId: "case_invoice_001",
        amountCents: 480_000,
        partyA: {
          name: "Priya Raman",
          phone: SUPPLIER_PHONE,
          private: { reservationCents: 200_000, notes: SUPPLIER_SECRET },
        },
        partyB: {
          name: "Marcus Webb",
          phone: CUSTOMER_PHONE,
          private: { reservationCents: 300_000, notes: CUSTOMER_SECRET },
        },
      }),
      "2026-08-03T16:00:00.000Z",
    );
    // No test-side tweaks: the case runs on the config's own default policy.
    expect(rec.policy).toEqual(config.defaultPolicy);

    const genesis = genesisEvent(rec);
    ledger.append({
      caseId: rec.caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });

    // A (supplier) is owed money -> "stubborn" persona opening at the full amount.
    // B (customer) owes money -> "agreeable" persona with a ceiling.
    const client = new MockCalleClient(
      routed(stubbornTenant(4800), agreeableLandlord(1500, 3000)),
    );
    const { rec: final, finished } = await runCase({
      rec,
      client,
      ledger,
      maxSteps: 40,
      clock: stepClock("2026-08-03T16:00:00.000Z"),
    });

    expect(finished).toBe(true);
    expect(final.state).toBe("settled");
    expect(final.dispute.vertical).toBe("unpaid-invoice");

    // A real negotiation, not a scripted handshake: several alternating rounds,
    // within the config's own round budget, ending in an accept.
    expect(final.rounds.length).toBeGreaterThanOrEqual(4);
    expect(final.rounds.length).toBeLessThanOrEqual(config.defaultPolicy.maxRounds);
    for (const round of final.rounds) {
      expect(round.callee).toBe(round.n % 2 === 1 ? "A" : "B");
    }
    expect(final.rounds.at(-1)!.offer?.kind).toBe("accept");

    const settlement = final.settlement!;
    expect(settlement.amountCents).toBeGreaterThan(0);
    expect(settlement.amountCents).toBeLessThanOrEqual(final.dispute.amountCents);
    expect(settlement.attestationPhrase).toMatch(/^\d{6}$/);

    // Dual attestation on separate calls, both verified against the digest code.
    const attA = settlement.attestations["A"]!;
    const attB = settlement.attestations["B"]!;
    expect(attA.verified).toBe(true);
    expect(attB.verified).toBe(true);
    expect(attA.callId).not.toBe(attB.callId);
    for (const att of [attA, attB]) {
      expect(verifySpokenPhrase(settlement.attestationPhrase, att.spokenPhrase).match).toBe(true);
    }

    // Consent-first ordering held in this vertical too.
    const consentIdx = client.requests
      .map((r, i) => (r.idempotencyKey.endsWith(":consent") ? i : -1))
      .filter((i) => i >= 0);
    const firstShuttleIdx = client.requests.findIndex((r) =>
      r.idempotencyKey.endsWith(":shuttle"),
    );
    expect(consentIdx).toHaveLength(2);
    expect(Math.max(...consentIdx)).toBeLessThan(firstShuttleIdx);

    // The config's prose actually reached the phone tasks: role labels are
    // spoken, and the consent script states the vertical's dispute noun.
    expect(client.requests.some((r) => r.task.includes("(the supplier)"))).toBe(true);
    expect(client.requests.some((r) => r.task.includes("(the customer)"))).toBe(true);
    const consentTask = client.requests[consentIdx[0]!]!.task;
    expect(consentTask).toContain("unpaid invoice");

    // Taint held in this vertical too: no cross-party secrets, no cross phones.
    for (const req of client.requests) {
      const foreignSecret = req.callee === "A" ? "COBALTLEDGERFERN" : "AURELIANMANIFEST";
      const foreignPhone = req.callee === "A" ? CUSTOMER_PHONE : SUPPLIER_PHONE;
      expect(req.task).not.toContain(foreignSecret);
      expect(req.task.replace(/\D+/g, "")).not.toContain(foreignPhone.replace(/\D+/g, ""));
      expect(req.phone).toBe(req.callee === "A" ? SUPPLIER_PHONE : CUSTOMER_PHONE);
    }

    // Ledger: intact chain, genesis to case_settled, and rehydration from the
    // ledger alone reproduces the settled case.
    const entries = ledger.entries(rec.caseId);
    expect(ledger.verifyChain(rec.caseId)).toEqual({ ok: true });
    expect(entries[0]!.type).toBe("case_created");
    expect(entries.at(-1)!.type).toBe("case_settled");
    const replayed = rehydrate(rec.caseId, entries);
    expect(replayed.state).toBe("settled");
    expect(replayed.epoch).toBe(final.epoch);
    expect(replayed.rounds.length).toBe(final.rounds.length);
    expect(replayed.settlement?.termsDigest).toBe(settlement.termsDigest);
  });

  it("freight-detention: the third shipped config also runs to settled unmodified", async () => {
    const config = loadVertical("freight-detention");
    const rec = createCase(
      caseInputForVertical(config, {
        caseId: "case_freight_001",
        amountCents: 90_000,
        partyA: { name: "Dana Ortiz", phone: "+15550000023" },
        partyB: { name: "Lee Calloway", phone: "+15550000024" },
      }),
      "2026-08-03T14:00:00.000Z",
    );
    expect(rec.policy).toEqual(config.defaultPolicy);

    const genesis = genesisEvent(rec);
    ledger.append({
      caseId: rec.caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });

    // A (broker) owes the disputed charge; B (carrier) is owed it.
    const client = new MockCalleClient(routed(agreeableLandlord(500, 800), stubbornTenant(900)));
    const { rec: final, finished } = await runCase({
      rec,
      client,
      ledger,
      maxSteps: 40,
      clock: stepClock("2026-08-03T14:00:00.000Z"),
    });

    expect(finished).toBe(true);
    expect(final.state).toBe("settled");
    expect(final.dispute.vertical).toBe("freight-detention");
    expect(final.rounds.length).toBeGreaterThanOrEqual(2);
    expect(final.rounds.length).toBeLessThanOrEqual(config.defaultPolicy.maxRounds);
    expect(final.settlement!.amountCents).toBeLessThanOrEqual(90_000);
    expect(ledger.verifyChain(rec.caseId)).toEqual({ ok: true });
  });

  it("a vertical invented inside this test settles end to end — nothing in src/ has ever seen it", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "caucus-invented-"));
    try {
      writeFileSync(
        join(configDir, "gym-membership-refund.json"),
        JSON.stringify(inventedConfig(), null, 2),
      );
      const config = loadVertical("gym-membership-refund", configDir);
      const rec = createCase(
        caseInputForVertical(config, {
          caseId: "case_gym_001",
          amountCents: 22_000,
          partyA: { name: "Sam Idris", phone: "+15550000025" },
          partyB: { name: "Jordan Pike", phone: "+15550000026" },
        }),
        "2026-08-03T17:00:00.000Z",
      );
      expect(rec.policy).toEqual(config.defaultPolicy);

      // A (member) is owed the refund; B (operator) owes it.
      const client = new MockCalleClient(routed(stubbornTenant(220), agreeableLandlord(60, 140)));
      const { rec: final, finished } = await runCase({
        rec,
        client,
        maxSteps: 40,
        clock: stepClock("2026-08-03T17:00:00.000Z"),
      });

      expect(finished).toBe(true);
      expect(final.state).toBe("settled");
      expect(final.dispute.vertical).toBe("gym-membership-refund");
      expect(final.rounds.length).toBeGreaterThanOrEqual(2);
      expect(final.rounds.length).toBeLessThanOrEqual(config.defaultPolicy.maxRounds);
      expect(final.settlement!.amountCents).toBeGreaterThan(0);
      expect(final.settlement!.amountCents).toBeLessThanOrEqual(22_000);
      expect(final.dispute.summary).toContain("membership refund");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

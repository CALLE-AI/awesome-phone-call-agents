/**
 * End-to-end: a complete mediated case driven through the real runner, state
 * machine, taint-checking renderer, attestation crypto and hash-chained ledger.
 * Only the phone network is mocked (scripted personas) — every other module is
 * the production one.
 *
 * All phone numbers here are fictional (+1555…) per repository convention.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CaseRecord, MockScript, Party, RenderedCall } from "../src/types.js";
import { agreeableLandlord, MockCalleClient, stubbornTenant } from "../src/calle.js";
import { openLedger, type Ledger } from "../src/ledger.js";
import { createCase, genesisEvent, rehydrate } from "../src/state.js";
import { runCase } from "../src/runner.js";
import { renderMemo } from "../src/memo.js";
import { verifySpokenPhrase } from "../src/attest.js";

const LANDLORD_PHONE = "+15550000001";
const TENANT_PHONE = "+15550000002";

/** Distinctive private data that must never cross to the other party's call. */
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

function depositCase(caseId = "case_deposit_001"): CaseRecord {
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

/** Route each persona to its own party, so one client serves both sides. */
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

/** Deterministic clock: one minute per step, so timestamps are reproducible. */
function stepClock(startIso = "2026-08-01T15:00:00.000Z"): () => string {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += 60_000;
    return iso;
  };
}

describe("end-to-end mediated case", () => {
  let dir: string;
  let ledger: Ledger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "caucus-e2e-"));
    ledger = openLedger(join(dir, "case.db"));
  });

  afterEach(() => {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("settles a security-deposit dispute from consent through dual attestation", async () => {
    const rec = depositCase();
    const genesis = genesisEvent(rec);
    ledger.append({
      caseId: rec.caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });

    const client = new MockCalleClient(twoPartyScript());
    const { rec: final, steps, finished } = await runCase({
      rec,
      client,
      ledger,
      maxSteps: 40,
      clock: stepClock(),
    });

    expect(finished).toBe(true);
    expect(final.state).toBe("settled");

    // Consent was obtained from BOTH parties before any offer was ever relayed.
    const consentCalls = client.requests.filter((r) => r.idempotencyKey.endsWith(":consent"));
    expect(consentCalls.map((r) => r.callee).sort()).toEqual(["A", "B"]);
    const firstShuttleIndex = client.requests.findIndex((r) =>
      r.idempotencyKey.endsWith(":shuttle"),
    );
    const lastConsentIndex = client.requests.reduce(
      (acc, r, i) => (r.idempotencyKey.endsWith(":consent") ? i : acc),
      -1,
    );
    expect(lastConsentIndex).toBeLessThan(firstShuttleIndex);

    // The parties actually negotiated: at least one round each, and the
    // settlement sits inside the range they bracketed.
    expect(final.rounds.length).toBeGreaterThanOrEqual(2);
    const settlement = final.settlement;
    expect(settlement).toBeDefined();
    expect(settlement!.amountCents).toBeGreaterThan(0);
    expect(settlement!.amountCents).toBeLessThanOrEqual(final.dispute.amountCents);

    // The accepted proposal's conditions survive into the settlement. "I accept"
    // rarely restates the other side's conditions, and dropping them would produce
    // a memorandum that misstates what was agreed. (Regression: they were dropped.)
    const acceptRound = final.rounds.at(-1)!;
    expect(acceptRound.offer?.kind).toBe("accept");
    const standing = [...final.rounds]
      .reverse()
      .find((r) => r.callee !== acceptRound.callee && r.offer?.kind === "counter")!;
    for (const condition of standing.offer!.conditions) {
      expect(settlement!.conditions).toContain(condition);
    }

    // The confirmation token must be a DIGIT CODE, not words. Live calls showed a
    // three-word phrase does not survive ASR ("topaz chowder cyclone" came back as
    // "Joe Pads, chowder, 2nd 1."), so this pins the encoding against reverting.
    expect(settlement!.attestationPhrase).toMatch(/^\d{6}$/);

    // Dual attestation: both parties spoke the SAME phrase, on separate calls.
    const attA = settlement!.attestations["A"];
    const attB = settlement!.attestations["B"];
    expect(attA?.verified).toBe(true);
    expect(attB?.verified).toBe(true);
    expect(attA!.callId).not.toBe(attB!.callId);
    for (const att of [attA!, attB!]) {
      expect(verifySpokenPhrase(settlement!.attestationPhrase, att.spokenPhrase).match).toBe(true);
    }

    // The ledger is intact and every step is accounted for.
    const entries = ledger.entries(rec.caseId);
    expect(ledger.verifyChain(rec.caseId)).toEqual({ ok: true });
    expect(entries[0]!.type).toBe("case_created");
    expect(entries.at(-1)!.type).toBe("case_settled");
    expect(steps.every((s) => !s.noop)).toBe(true);

    // An accept emits TWO drafts (offer_recorded + settlement_proposed). They must
    // share one epoch and both be present: written row-by-row, a crash between them
    // leaves a "torn accept" whose healed terms once diverged from the live path.
    const settlementEntry = entries.find((e) => e.type === "settlement_proposed")!;
    const siblings = entries.filter((e) => e.epoch === settlementEntry.epoch);
    expect(siblings.map((e) => e.type).sort()).toEqual(["offer_recorded", "settlement_proposed"]);

    // Rehydrating from the ledger alone reproduces the same case.
    const replayed = rehydrate(rec.caseId, entries);
    expect(replayed.state).toBe(final.state);
    expect(replayed.epoch).toBe(final.epoch);
    expect(replayed.rounds.length).toBe(final.rounds.length);
    expect(replayed.settlement?.termsDigest).toBe(settlement!.termsDigest);
  });

  it("never leaks either party's private data into the other party's call", async () => {
    const rec = depositCase("case_deposit_leak");
    const client = new MockCalleClient(twoPartyScript());
    await runCase({ rec, client, maxSteps: 40, clock: stepClock() });

    expect(client.requests.length).toBeGreaterThan(3);
    for (const req of client.requests) {
      const foreignSecret = req.callee === "A" ? "MARMALADEHELIX" : "ZEPHYRQUARTZ";
      const foreignPhone = req.callee === "A" ? TENANT_PHONE : LANDLORD_PHONE;
      expect(req.task).not.toContain(foreignSecret);
      expect(req.task.replace(/\D+/g, "")).not.toContain(foreignPhone.replace(/\D+/g, ""));
      // ...and the call went to the right person.
      expect(req.phone).toBe(req.callee === "A" ? LANDLORD_PHONE : TENANT_PHONE);
    }
  });

  it("produces a settlement memorandum that masks phones and cites evidence", async () => {
    const rec = depositCase("case_deposit_memo");
    const genesis = genesisEvent(rec);
    ledger.append({
      caseId: rec.caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });
    const client = new MockCalleClient(twoPartyScript());
    const { rec: final } = await runCase({
      rec,
      client,
      ledger,
      maxSteps: 40,
      clock: stepClock(),
    });

    const memo = renderMemo(final, ledger.entries(rec.caseId), "2026-08-01T18:00:00.000Z");

    expect(memo).not.toContain(LANDLORD_PHONE);
    expect(memo).not.toContain(TENANT_PHONE);
    expect(memo).not.toContain("ZEPHYRQUARTZ");
    expect(memo).not.toContain("MARMALADEHELIX");
    expect(memo).toContain(final.settlement!.termsDigest);
    // Non-binding notice is mandatory on every memorandum.
    expect(memo.toLowerCase()).toContain("non-binding");
  });

  it("settles when a callee false-starts the attestation code (live-call replay)", async () => {
    // Gate A4, round 3: a real callee read back "935 935006." — a false start
    // followed by the complete correct code — and exact matching wrongly kept
    // the case pending forever. This drives the same utterance shape through
    // the PRODUCTION pipeline (runner -> injected verifier -> state machine).
    const rec = depositCase("case_false_start");
    const base = twoPartyScript();
    const CODE_RE = /word for word: "(\d+)"/;
    const client = new MockCalleClient({
      matchers: [
        {
          when: (r: RenderedCall) => r.idempotencyKey.endsWith(":attestation"),
          respond: (r: RenderedCall) => {
            const code = CODE_RE.exec(r.task)![1]!;
            const spoken = r.callee === "A" ? `${code.slice(0, 3)} ${code}.` : code;
            return {
              outcome: "completed",
              structured: { phrase_spoken: spoken, agrees_to_terms: "yes" },
              confidence: { score: 0.82, label: "high" },
              evidence: [spoken],
              transcript: [{ offsetSeconds: 10, speaker: "user", text: spoken }],
            };
          },
        },
        ...base.matchers!,
      ],
    });
    const { rec: final, finished } = await runCase({
      rec,
      client,
      maxSteps: 40,
      clock: stepClock(),
    });
    expect(finished).toBe(true);
    expect(final.state).toBe("settled");
    expect(final.settlement!.attestations["A"]?.verified).toBe(true);
    // The ledger records what was actually said — false start and all.
    expect(final.settlement!.attestations["A"]?.spokenPhrase).toMatch(/^\d{3} \d{6}\.$/);
  });

  it("is deterministic: identical inputs produce an identical settlement digest", async () => {
    const run = async () => {
      const client = new MockCalleClient(twoPartyScript());
      const { rec } = await runCase({
        rec: depositCase("case_determinism"),
        client,
        maxSteps: 40,
        clock: stepClock(),
      });
      return rec;
    };
    const [first, second] = await Promise.all([run(), run()]);
    expect(first.settlement?.termsDigest).toBe(second.settlement?.termsDigest);
    expect(first.settlement?.attestationPhrase).toBe(second.settlement?.attestationPhrase);
    expect(first.rounds.length).toBe(second.rounds.length);
  });
});

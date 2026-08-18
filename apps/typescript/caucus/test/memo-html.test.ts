/**
 * Printable settlement memorandum (HTML).
 *
 * The settled fixture is produced by the PRODUCTION pipeline — a full mock
 * case in the security-deposit vertical driven through the runner, state
 * machine, renderer, attestation and ledger — so these assertions hold for
 * documents the system actually emits, not hand-shaped inputs. One test does
 * hand-build a record: the HTML-injection fixture, whose hostile strings could
 * never survive the taint-checking renderer but could arrive via a compromised
 * transcript, which is exactly what escaping must survive.
 *
 * All phone numbers here are fictional (+1555…) per repository convention.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CaseRecord, LedgerEntry, RenderedCall } from "../src/types.js";
import {
  agreeableLandlord,
  MockCalleClient,
  stubbornTenant,
  type MockScript,
} from "../src/calle.js";
import { openLedger } from "../src/ledger.js";
import { createCase, genesisEvent, rehydrate } from "../src/state.js";
import { runCase } from "../src/runner.js";
import { MEMO_NOTICE } from "../src/memo.js";
import { escapeHtml, renderMemoHtml } from "../src/memo-html.js";
import { caseInputForVertical, loadVertical } from "../src/verticals.js";

const LANDLORD_PHONE = "+15550000031";
const TENANT_PHONE = "+15550000032";
const LANDLORD_SECRET = "XANTHICORBITNOTE keeps a spare garage remote";
const TENANT_SECRET = "VELVETQUASARNOTE maxed a credit card on movers";
const NOW = "2026-08-05T12:00:00.000Z";

function stepClock(startIso: string): () => string {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += 60_000;
    return iso;
  };
}

function routed(a: MockScript, b: MockScript): MockScript {
  return {
    matchers: [
      { when: (r: RenderedCall) => r.callee === "A", respond: (r) => a.default!(r) },
      { when: (r: RenderedCall) => r.callee === "B", respond: (r) => b.default!(r) },
    ],
  };
}

/** Drive one security-deposit case to "settled" through the production stack. */
async function settleCase(): Promise<{ rec: CaseRecord; entries: LedgerEntry[] }> {
  const dir = mkdtempSync(join(tmpdir(), "caucus-memo-html-"));
  const ledger = openLedger(join(dir, "case.db"));
  try {
    const config = loadVertical("security-deposit");
    const rec = createCase(
      caseInputForVertical(config, {
        caseId: "case_memo_html_001",
        amountCents: 120_000,
        partyA: {
          name: "Avery Stone",
          phone: LANDLORD_PHONE,
          private: { reservationCents: 40_000, notes: LANDLORD_SECRET },
        },
        partyB: {
          name: "Rowan Ellis",
          phone: TENANT_PHONE,
          private: { reservationCents: 55_000, notes: TENANT_SECRET },
        },
      }),
      "2026-08-01T15:00:00.000Z",
    );
    const genesis = genesisEvent(rec);
    ledger.append({
      caseId: rec.caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });
    const client = new MockCalleClient(routed(agreeableLandlord(400, 700), stubbornTenant(1200)));
    const { rec: final, finished } = await runCase({
      rec,
      client,
      ledger,
      maxSteps: 40,
      clock: stepClock("2026-08-01T15:00:00.000Z"),
    });
    expect(finished).toBe(true);
    expect(final.state).toBe("settled");
    return { rec: final, entries: ledger.entries(rec.caseId) };
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("renderMemoHtml on a settled case from the production pipeline", () => {
  let rec: CaseRecord;
  let entries: LedgerEntry[];
  let html: string;

  beforeAll(async () => {
    ({ rec, entries } = await settleCase());
    html = renderMemoHtml(rec, entries, NOW);
  });

  it("is a single self-contained document with no external assets", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>");
    expect(html).toContain(rec.caseId);
    expect(html).toContain("<style>");
    // Print-to-PDF must never depend on the network or on script execution.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("masks phones to last four digits and leaks no private intake data", () => {
    expect(html).toContain("***0031");
    expect(html).toContain("***0032");
    expect(html).not.toContain(LANDLORD_PHONE);
    expect(html).not.toContain(TENANT_PHONE);
    // Even ignoring formatting, the full number sequences must be absent.
    const digitsOnly = html.replace(/\D+/g, "");
    expect(digitsOnly).not.toContain(LANDLORD_PHONE.replace(/\D+/g, ""));
    expect(digitsOnly).not.toContain(TENANT_PHONE.replace(/\D+/g, ""));
    // Party-private sentinels (reservation notes) never reach the document.
    expect(html).not.toContain("XANTHICORBITNOTE");
    expect(html).not.toContain("VELVETQUASARNOTE");
  });

  it("carries the digest, confirmation code, both attestations, and the chain head", () => {
    const settlement = rec.settlement!;
    expect(html).toContain(settlement.termsDigest);
    expect(html).toContain(settlement.attestationPhrase);
    const attA = settlement.attestations["A"]!;
    const attB = settlement.attestations["B"]!;
    for (const att of [attA, attB]) {
      expect(html).toContain(att.callId);
      expect(html).toContain(escapeHtml(att.spokenPhrase));
    }
    expect(html).toContain(">verified<");
    expect(html).not.toContain("NOT VERIFIED"); // both attestations verified here
    expect(html).toContain(entries.at(-1)!.hash); // ledger chain head
    expect(html).toContain(`Entries: ${entries.length}`);
  });

  it("shows the full round table with evidence quotes and party labels", () => {
    expect(html).toContain("Avery Stone (the landlord)");
    expect(html).toContain("Rowan Ellis (the tenant)");
    for (const round of rec.rounds) {
      for (const quote of round.offer?.evidence ?? []) {
        expect(html).toContain(escapeHtml(quote));
      }
    }
    // Every completed round number appears as a table row.
    expect(html.match(/<tr class="round">/g)!.length).toBe(rec.rounds.length);
  });

  it("carries the mandatory non-binding notice verbatim", () => {
    expect(html).toContain(MEMO_NOTICE);
    expect(html.toLowerCase()).toContain("non-binding");
    expect(html.toLowerCase()).toContain("not legal advice");
  });

  it("is deterministic: same inputs, byte-identical output; nowIso is the only clock", () => {
    expect(renderMemoHtml(rec, entries, NOW)).toBe(html);
    const later = renderMemoHtml(rec, entries, "2026-08-06T09:30:00.000Z");
    expect(later).not.toBe(html);
    expect(later).toContain("2026-08-06T09:30:00.000Z");
  });

  it("renders identically from a case rehydrated out of the ledger alone", () => {
    const replayed = rehydrate(rec.caseId, entries);
    expect(renderMemoHtml(replayed, entries, NOW)).toBe(html);
  });
});

describe("renderMemoHtml escaping and non-settled cases", () => {
  const ISO = "2026-08-05T10:00:00.000Z";

  it("escapes hostile case-derived strings — transcripts are untrusted input", () => {
    const hostile: CaseRecord = {
      caseId: "case_html_escape",
      state: "settled",
      dispute: {
        vertical: "security-deposit",
        summary: 'Deposit dispute <script>alert("x")</script> & "quoted" summary',
        amountCents: 50_000,
        currency: "USD",
      },
      parties: [
        {
          id: "A",
          label: "Mallory & Sons <b>bold</b>",
          phone: "+15550000033",
          private: {},
        },
        { id: "B", label: "Trent <i>", phone: "+15550000034", private: {} },
      ],
      rounds: [
        {
          n: 1,
          callee: "A",
          callId: "call_hostile_1",
          offer: {
            kind: "open",
            amountCents: 40_000,
            conditions: ['<img src=x onerror="p()"> returned'],
            publicRationale: "a & b",
            evidence: ['quote with <tags> & "double quotes"'],
          },
          outcome: "completed",
          startedAt: ISO,
          completedAt: ISO,
        },
      ],
      epoch: 5,
      settlement: {
        amountCents: 40_000,
        conditions: ["<script>steal()</script> keys returned"],
        termsDigest: "d1e5c0ffee00000000000000000000000000000000000000000000000000abcd",
        attestationPhrase: "123456",
        attestations: {
          A: { callId: "call_att_a", spokenPhrase: "1 2 3 <script>", verified: true, at: ISO },
          B: { callId: "call_att_b", spokenPhrase: "123456", verified: false, at: ISO },
        },
      },
      policy: {
        maxRounds: 8,
        coolingOffMinutes: 0,
        callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
        retryDelaysMinutes: [],
        ttlHours: 72,
      },
      createdAt: ISO,
      updatedAt: ISO,
    };

    const html = renderMemoHtml(hostile, [], ISO);
    // No raw injected markup survives...
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold</b>");
    // ...but the content is still present, escaped.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Mallory &amp; Sons &lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;p()&quot;&gt; returned");
    expect(html).toContain("quote with &lt;tags&gt; &amp; &quot;double quotes&quot;");
    // An unverified attestation is called out loudly, not hidden.
    expect(html).toContain("NOT VERIFIED");
  });

  it("renders a case with no rounds and no settlement honestly", () => {
    const config = loadVertical("security-deposit");
    const rec = createCase(
      caseInputForVertical(config, {
        caseId: "case_memo_html_open",
        amountCents: 80_000,
        partyA: { name: "Avery Stone", phone: "+15550000035" },
        partyB: { name: "Rowan Ellis", phone: "+15550000036" },
      }),
      ISO,
    );
    const html = renderMemoHtml(rec, [], ISO);
    expect(html).toContain("No shuttle rounds were completed.");
    expect(html).toContain("No settlement was reached on this case.");
    expect(html).toContain("Chain head hash: &mdash;");
    expect(html).toContain("Entries: 0");
    // The notice is mandatory on EVERY memorandum, settled or not.
    expect(html).toContain(MEMO_NOTICE);
    // Phones stay masked even on an empty case.
    expect(html).toContain("***0035");
    expect(html).not.toContain("+15550000035");
  });

  it("escapeHtml covers the five HTML-special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});

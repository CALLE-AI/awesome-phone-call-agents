/**
 * Builds demo.db: settled mock cases with VERTICAL-APPROPRIATE personas.
 *
 * Why this file exists (and why it is not three lines): the first demo build
 * reused the security-deposit personas for an unpaid-invoice case, which put
 * "tenant returns both mailbox keys" inside an invoice settlement and had the
 * supplier opening LOW — a creditor conceding before negotiating. Nothing in
 * the engine prevents nonsensical demo data; only the data can be sensible.
 * Each vertical here scripts parties whose direction, conditions, rationale
 * and quotes belong to that dispute type:
 *   - deposit: payer (landlord) opens low and climbs; payee (tenant) opens at
 *     the full deposit and concedes down.
 *   - invoice: claimant (supplier) opens at the FULL invoice and concedes
 *     down; payer (customer) opens low and climbs.
 *
 * Usage: npx tsx scripts/build-demo.ts [out.db]
 */
import { rmSync } from "node:fs";
import type { MockScript, RenderedCall } from "../src/types.js";
import { MockCalleClient, classifyCall, extractRelayedDollars } from "../src/calle.js";
import { createCase, genesisEvent } from "../src/state.js";
import { runCase } from "../src/runner.js";
import { openLedger } from "../src/ledger.js";
import { loadVertical, caseInputForVertical } from "../src/verticals.js";

const OUT = process.argv[2] ?? "demo.db";

interface PersonaSpec {
  /** First amount this party names, dollars. */
  openDollars: number;
  /** Bound at which this party accepts a relayed proposal, dollars. */
  acceptAtDollars: (relayed: number) => boolean;
  /** Next concession from this party given their previous amount. */
  concede: (prevOwn: number) => number;
  condition: string;
  rationale: string;
  quote: (amount: number) => string;
  consentQuote: string;
}

/** Generic scripted negotiator built from a spec; direction lives in the spec. */
function negotiator(spec: PersonaSpec): MockScript {
  let lastOwn: number | null = null;
  return {
    default: (req: RenderedCall) => {
      switch (classifyCall(req)) {
        case "consent":
          return {
            outcome: "completed" as const,
            structured: { consent: "yes", concerns: "" },
            confidence: { score: 0.93, label: "high" },
            evidence: [spec.consentQuote],
            transcript: [{ offsetSeconds: 8, speaker: "user" as const, text: spec.consentQuote }],
          };
        case "attestation": {
          const code = /word for word: "(\d+)"/.exec(req.task)?.[1] ?? "";
          return {
            outcome: "completed" as const,
            structured: { phrase_spoken: code, agrees_to_terms: "yes" },
            confidence: { score: 0.9, label: "high" },
            evidence: [code],
            transcript: [{ offsetSeconds: 12, speaker: "user" as const, text: code }],
          };
        }
        case "offer": {
          const relayed = extractRelayedDollars(req.task);
          if (relayed !== null && spec.acceptAtDollars(relayed)) {
            const quote = `Fine — ${fmt(relayed)} works. Let's close it out.`;
            return offer("accept", relayed, [], "Wants this resolved this week.", quote);
          }
          const amount =
            lastOwn === null ? spec.openDollars : spec.concede(lastOwn);
          const kind = lastOwn === null ? "open" : "counter";
          lastOwn = amount;
          return offer(kind, amount, [spec.condition], spec.rationale, spec.quote(amount));
        }
        default:
          return {};
      }
    },
  };

  function offer(
    kind: string,
    amount: number,
    conditions: string[],
    rationale: string,
    quote: string,
  ) {
    return {
      outcome: "completed" as const,
      structured: {
        offer_kind: kind,
        amount_dollars: amount,
        conditions,
        public_rationale: rationale,
        verbatim_quote: quote,
      },
      confidence: { score: 0.9, label: "high" },
      evidence: [quote],
      transcript: [{ offsetSeconds: 20, speaker: "user" as const, text: quote }],
    };
  }
}

function fmt(d: number): string {
  return `$${d.toLocaleString("en-US")}`;
}

interface DemoCase {
  caseId: string;
  verticalId: string;
  amountCents: number;
  partyA: { name: string; persona: PersonaSpec };
  partyB: { name: string; persona: PersonaSpec };
}

const CASES: DemoCase[] = [
  {
    caseId: "case_deposit_demo",
    verticalId: "security-deposit",
    amountCents: 120_000,
    // Landlord pays: opens low, climbs $100/round, accepts <= $700.
    partyA: {
      name: "Sunrise Property Mgmt",
      persona: {
        openDollars: 400,
        acceptAtDollars: (r) => r <= 700,
        concede: (p) => Math.min(700, p + 100),
        condition: "tenant returns both mailbox keys",
        rationale: "The carpet replacement had a real cost.",
        quote: (a) => `The most I can do right now is ${fmt(a)}.`,
        consentQuote: "Yes, I'd rather settle this than go to small claims.",
      },
    },
    // Tenant is owed: opens at the full deposit, concedes ~20%/round, accepts >= own next concession.
    partyB: {
      name: "T. Alvarez",
      persona: {
        openDollars: 1200,
        acceptAtDollars: (r) => r >= 690,
        concede: (p) => Math.round(p * 0.8),
        condition: "landlord provides an itemized deduction list",
        rationale: "The unit was left clean and photographed.",
        quote: (a) => `I want ${fmt(a)} back — I have photos of how clean I left it.`,
        consentQuote: "Yes, fine, let's get my deposit sorted out.",
      },
    },
  },
  {
    caseId: "case_invoice_demo",
    verticalId: "unpaid-invoice",
    amountCents: 348_500,
    // Supplier is OWED: opens at the full invoice, concedes down, accepts >= ~55%.
    partyA: {
      name: "Kestrel Supply Co",
      persona: {
        openDollars: 3485,
        acceptAtDollars: (r) => r >= 1950,
        concede: (p) => Math.round(p * 0.85),
        condition: "customer signs the corrected delivery receipt",
        rationale: "The goods shipped complete against the signed purchase order.",
        quote: (a) => `Invoice 2214 stands at ${fmt(a)} — the pallets left our dock complete.`,
        consentQuote: "Yes — ninety days overdue, I'll take a mediated number.",
      },
    },
    // Customer pays: opens low citing the shortage, climbs, accepts <= ~$2,100.
    partyB: {
      name: "Harbor Bistro LLC",
      persona: {
        openDollars: 900,
        acceptAtDollars: (r) => r <= 2100,
        concede: (p) => Math.round(p * 1.3),
        condition: "supplier issues a credit memo for the short-shipped case",
        rationale: "One pallet arrived a full case short.",
        quote: (a) => `We'll pay ${fmt(a)} — we're not paying for a case we never received.`,
        consentQuote: "Agreed, a call beats another month of emails.",
      },
    },
  },
];

rmSync(OUT, { force: true });
const ledger = openLedger(OUT);

for (const demo of CASES) {
  const vertical = loadVertical(demo.verticalId);
  const input = caseInputForVertical(vertical, {
    caseId: demo.caseId,
    amountCents: demo.amountCents,
    partyA: { name: demo.partyA.name, phone: "+15550000001" },
    partyB: { name: demo.partyB.name, phone: "+15550000002" },
    policy: { coolingOffMinutes: 0, retryDelaysMinutes: [] },
  });
  const rec = createCase(input, "2026-08-08T14:00:00.000Z");
  const g = genesisEvent(rec);
  ledger.append({ caseId: rec.caseId, epoch: rec.epoch, type: g.type, payload: g.payload, at: rec.createdAt });

  const a = negotiator(demo.partyA.persona);
  const b = negotiator(demo.partyB.persona);
  const client = new MockCalleClient({
    matchers: [
      { when: (r) => r.callee === "A", respond: (r) => a.default!(r) },
      { when: (r) => r.callee === "B", respond: (r) => b.default!(r) },
    ],
  });

  let t = Date.parse("2026-08-08T14:00:00.000Z");
  const out = await runCase({
    rec,
    client,
    ledger,
    maxSteps: 40,
    clock: () => {
      const iso = new Date(t).toISOString();
      t += 90_000;
      return iso;
    },
  });
  const s = out.rec.settlement;
  console.log(
    `${demo.caseId} -> ${out.rec.state} (${out.rec.rounds.length} rounds, ` +
      `settled ${s ? fmt(s.amountCents / 100) : "n/a"}, code ${s?.attestationPhrase}, ` +
      `conditions: ${JSON.stringify(s?.conditions)})`,
  );
  if (out.rec.state !== "settled") throw new Error(`${demo.caseId} did not settle`);
}
ledger.close();
console.log(`wrote ${OUT}`);

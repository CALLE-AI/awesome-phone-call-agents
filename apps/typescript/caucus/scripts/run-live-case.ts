/**
 * Phase C3 — run a FULL mediated case, one deliberate call at a time.
 *
 * LIVE MODE PLACES REAL PHONE CALLS. Every call requires pressing Enter first,
 * because the same human is role-playing both parties on two phones and needs
 * to switch hats between rings. Rehearse the entire flow with --rehearse
 * (scripted mock personas, zero calls) before ever passing --live.
 *
 * Crash-safe by construction: the case is rehydrated from the hash-chained
 * ledger on every start, so a killed process resumes exactly where it stopped.
 * Retries never replay a stale failure: the first attempt of each call uses
 * the canonical idempotency key (crash-safe against double dialing), while an
 * operator-requested retry appends a fresh suffix so CALL-E dials again
 * instead of returning the cached failed result.
 *
 * Real phone numbers come ONLY from CLI flags — never from any file in this
 * repository. The ledger DB produced here (live.db) is internal; everything
 * exported for the public (dashboard static export, memo) masks numbers.
 *
 * Usage:
 *   npx tsx scripts/run-live-case.ts --rehearse
 *   npx tsx scripts/run-live-case.ts --live --phone-a +1XXXXXXXXXX --phone-b +1YYYYYYYYYY
 */
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync } from "node:fs";

import type { CalleClient, CaseRecord, RenderedCall } from "../src/types.js";
import { MockCalleClient, RealCalleClient, agreeableLandlord, stubbornTenant } from "../src/calle.js";
import { createCase, genesisEvent, isTerminal, rehydrate } from "../src/state.js";
import { pendingWork, runStep } from "../src/runner.js";
import { openLedger } from "../src/ledger.js";
import { loadVertical, caseInputForVertical } from "../src/verticals.js";
import { renderMemo } from "../src/memo.js";
import { verifySpokenPhrase } from "../src/attest.js";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    rehearse: { type: "boolean", default: false },
    /** Auto-press Enter (rehearsal only) so the full flow runs non-interactively. */
    yes: { type: "boolean", default: false },
    db: { type: "string" },
    case: { type: "string", default: "case_live_deposit" },
    "phone-a": { type: "string" },
    "phone-b": { type: "string" },
  },
});

const LIVE = values.live === true;
if (LIVE === (values.rehearse === true)) {
  console.error("pick exactly one mode: --rehearse (mock, safe) or --live (REAL CALLS)");
  process.exit(1);
}
const DB = values.db ?? (LIVE ? "live.db" : "rehearsal.db");
const CASE_ID = values.case!;
const E164 = /^\+[1-9]\d{6,14}$/;

const phoneA = LIVE ? values["phone-a"] : "+15550000001";
const phoneB = LIVE ? values["phone-b"] : "+15550000002";
if (LIVE && (!E164.test(phoneA ?? "") || !E164.test(phoneB ?? ""))) {
  console.error("--live requires --phone-a and --phone-b in E.164 (numbers never live in files)");
  process.exit(1);
}
const apiKey = process.env["CALLE_API_KEY"];
if (LIVE && !apiKey) {
  console.error("CALLE_API_KEY not set — run: set -a; source ../.env; set +a");
  process.exit(1);
}

/** Retry-aware client wrapper: canonical key first, fresh suffix on redial. */
class RetryingClient implements CalleClient {
  private attempts = new Map<string, number>();
  constructor(private readonly inner: CalleClient) {}
  async createAndWait(req: RenderedCall) {
    const n = this.attempts.get(req.idempotencyKey) ?? 0;
    this.attempts.set(req.idempotencyKey, n + 1);
    const key = n === 0 ? req.idempotencyKey : `${req.idempotencyKey}:r${n}-${Date.now() % 1_000_000}`;
    return this.inner.createAndWait({ ...req, idempotencyKey: key });
  }
}

function buildClient(): CalleClient {
  if (!LIVE) {
    const a = agreeableLandlord(400, 700);
    const b = stubbornTenant(1200);
    return new MockCalleClient({
      matchers: [
        { when: (r) => r.callee === "A", respond: (r) => a.default!(r) },
        { when: (r) => r.callee === "B", respond: (r) => b.default!(r) },
      ],
    });
  }
  return new RetryingClient(new RealCalleClient({ apiKey: apiKey!, waitTimeoutMs: 10 * 60_000 }));
}

const CUE: Record<string, (callee: "A" | "B") => string> = {
  consent: (c) =>
    c === "A"
      ? 'LANDLORD phone rings. Say: "Yes, I consent to the mediation. I\'d rather settle this."'
      : 'TENANT (Google Voice) rings. Say: "Yes, I agree to take these calls. Let\'s sort out the deposit."',
  shuttle: (c) =>
    c === "A"
      ? "LANDLORD phone rings — respond to the tenant's last position (see negotiation table)."
      : "TENANT (Google Voice) rings — respond to the landlord's last position (see negotiation table).",
  attestation: (c) =>
    `${c === "A" ? "LANDLORD phone" : "TENANT (Google Voice)"} rings. WAIT for the agent to read ` +
    "the 6-digit code. Read it back DIGIT BY DIGIT. If it re-reads, calmly read it back again. " +
    'Then: "Yes, I agree to settle on exactly those terms."',
};

const NEGOTIATION_TABLE = `
  ┌─ NEGOTIATION SCRIPT (speak naturally; amounts as words) ─────────────────┐
  │ R1 LANDLORD open:    "I can offer four hundred dollars. The carpet       │
  │                       replacement had a real cost. My condition is the   │
  │                       tenant returns both mailbox keys."                 │
  │ R2 TENANT counter:   "I want one thousand dollars back. The unit was     │
  │                       left clean — I have photos. And I want an          │
  │                       itemized deduction list."                          │
  │ R3 LANDLORD counter: "I can go up to five hundred fifty dollars, if the  │
  │                       mailbox keys come back."                           │
  │ R4 TENANT counter:   "I'll come down to eight hundred dollars, with the  │
  │                       itemized list."                                    │
  │ R5 LANDLORD counter: "Seven hundred dollars. That's my final offer,      │
  │                       with the keys returned."                           │
  │ R6 TENANT accept:    "Okay — I accept seven hundred dollars."            │
  │ (tired? accepting in R4 instead is fine — 3+ rounds still satisfies C3)  │
  └──────────────────────────────────────────────────────────────────────────┘`;

async function main(): Promise<void> {
  const ledger = openLedger(DB);
  const rl = createInterface({ input: stdin, output: stdout });

  // Rehydrate if the ledger already has this case; otherwise create it.
  let rec: CaseRecord;
  const existing = ledger.entries(CASE_ID);
  if (existing.length > 0) {
    rec = rehydrate(CASE_ID, existing);
    console.log(`resumed ${CASE_ID} from ledger: state=${rec.state}, epoch=${rec.epoch}, rounds=${rec.rounds.length}`);
  } else {
    const vertical = loadVertical("security-deposit");
    const input = caseInputForVertical(vertical, {
      caseId: CASE_ID,
      amountCents: 120_000,
      partyA: { name: "Sunrise Property Mgmt", phone: phoneA! },
      partyB: { name: "T. Alvarez", phone: phoneB! },
      policy: {
        coolingOffMinutes: 0,
        retryDelaysMinutes: [],
        // Evening-friendly window so recorded timestamps never contradict policy.
        callWindow: { startHour: 9, endHour: 23, timezone: "America/New_York" },
      },
    });
    rec = createCase(input);
    const g = genesisEvent(rec);
    ledger.append({ caseId: rec.caseId, epoch: rec.epoch, type: g.type, payload: g.payload, at: rec.createdAt });
    console.log(`created ${CASE_ID} (${LIVE ? "LIVE" : "rehearsal"})`);
  }

  const client = buildClient();
  console.log(LIVE
    ? "\n☎ LIVE MODE — every Enter places a REAL call. Ctrl-C anytime; the ledger resumes."
    : "\n○ rehearsal mode — scripted mock callees, zero real calls.");
  console.log(NEGOTIATION_TABLE);

  while (!isTerminal(rec.state)) {
    const work = pendingWork(rec);
    if (work.kind === "none") break;
    if (work.kind === "tick") {
      const step = await runStep({ rec, client, ledger, now: new Date().toISOString() });
      rec = step.rec;
      continue;
    }
    const round = work.purpose === "shuttle" ? ` (round ${rec.rounds.length + 1})` : "";
    console.log(`\n━━ NEXT: ${work.purpose}${round} → party ${work.callee}`);
    console.log(`   ${CUE[work.purpose]!(work.callee)}`);
    if (LIVE || values.yes !== true) {
      const answer = await rl.question(LIVE ? "   [Enter]=dial  q=quit > " : "   [Enter]=simulate  q=quit > ");
      if (answer.trim().toLowerCase() === "q") break;
    }

    const step = await runStep({ rec, client, ledger, now: new Date().toISOString() });
    const r = step.result;
    console.log(`   outcome=${r?.outcome} confidence=${r?.confidence?.score ?? "-"}`);
    if (r?.structured) console.log(`   extracted: ${JSON.stringify(r.structured)}`);
    if (step.noop) {
      console.log("   ⚠ state unchanged (failed call or unusable extraction). Enter re-dials with a fresh key.");
    } else {
      console.log(`   state → ${step.rec.state} (epoch ${step.rec.epoch})`);
    }
    rec = step.rec;
  }

  console.log(`\nfinal state: ${rec.state}`);
  if (rec.state === "settled") {
    const entries = ledger.entries(CASE_ID);
    const chain = ledger.verifyChain(CASE_ID);
    const s = rec.settlement!;
    const attOk = (["A", "B"] as const).every(
      (p) => s.attestations[p]?.verified && verifySpokenPhrase(s.attestationPhrase, s.attestations[p]!.spokenPhrase).match,
    );
    console.log(`ledger chain: ${chain.ok ? "VERIFIED" : "BROKEN"} (${entries.length} entries)`);
    console.log(`attestations verified: ${attOk}`);
    const memoPath = `${CASE_ID}-memo.md`;
    writeFileSync(memoPath, renderMemo(rec, entries, new Date().toISOString()));
    console.log(`memorandum: ${memoPath}`);
    console.log(`settled: $${(s.amountCents / 100).toFixed(2)} | conditions: ${JSON.stringify(s.conditions)} | code: ${s.attestationPhrase}`);
  }
  rl.close();
  ledger.close();
}

await main();

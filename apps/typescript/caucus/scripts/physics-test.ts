/**
 * Gate A4 — live physics test. THIS PLACES REAL PHONE CALLS.
 *
 * Everything in Caucus is verified against mock call results. This script tests
 * the three assumptions that mocks cannot prove, using the real renderer and
 * real schemas against a real CALL-E voice agent:
 *
 *   1. OFFER CONVEYANCE — does the agent relay the other party's proposal
 *      faithfully, and capture a spoken counter-offer into the strict schema?
 *   2. PHRASE ECHO — is a 3-word confirmation phrase captured verbatim enough
 *      that `verifySpokenPhrase` accepts it? (Partially validated already by the
 *      smoke call, which round-tripped "Amber Falcon" at 0.95 confidence.)
 *   3. NEUTRALITY / NO-LEAK — does the transcript show the agent staying neutral
 *      and never voicing anything outside the taint-safe view?
 *
 * Pass bar (from CHECKLIST Gate A4): >= 80% clean extraction over the run.
 * Failing after prompt iteration triggers the documented pivot to Recheck.
 *
 * Usage (from caucus/):
 *   set -a; source ../.env; set +a
 *   npx tsx scripts/physics-test.ts --to +1XXXXXXXXXX [--only offer|phrase]
 *
 * Costs ~4 calls (or ~2 with --only). Answer the phone and follow the prompts;
 * the script prints exactly what to say before each call.
 */
import { parseArgs } from "node:util";
import { CalleClient } from "@call-e/calle";

import { offerRelaySchema, attestationSchema, parseOffer, parseAttestation } from "../src/schemas.js";
import { verifySpokenCode } from "../src/attest.js";

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    only: { type: "string" },
    /**
     * Idempotency-key suffix. CALL-E treats a repeated key as the SAME logical
     * command and replays the stored result instead of dialing, so re-running
     * this script with a fixed key would silently return the previous run's
     * answers. Each attempt therefore needs its own run id.
     */
    run: { type: "string" },
  },
});
const runId = values.run ?? String(Math.floor(Date.now() / 1000));

const to = values.to;
if (to === undefined || !/^\+[1-9]\d{6,14}$/.test(to)) {
  console.error("usage: physics-test.ts --to <E.164 phone you own> [--only offer|phrase]");
  process.exit(1);
}
const apiKey = process.env["CALLE_API_KEY"];
if (apiKey === undefined) {
  console.error("CALLE_API_KEY not set — run: set -a; source ../.env; set +a");
  process.exit(1);
}

const client = new CalleClient({ apiKey });

interface Probe {
  id: string;
  /** What the human answering should do — printed before the call. */
  instructions: string;
  task: string;
  resultSchema: Record<string, unknown>;
  /** Returns null when clean, or a string describing the defect. */
  check: (structured: unknown, transcript: string) => string | null;
}

const NEUTRALITY_VIOLATIONS = [
  "you should",
  "i recommend",
  "i advise",
  "in my opinion",
  "you would win",
  "that is unfair",
];

/** Shared neutrality scan over the bot's turns. */
function neutralityDefect(transcript: string): string | null {
  const lower = transcript.toLowerCase();
  const hit = NEUTRALITY_VIOLATIONS.find((v) => lower.includes(v));
  return hit === undefined ? null : `agent broke neutrality: said "${hit}"`;
}

/** Fixed test code (a real settlement derives this from the terms digest). */
const CODE = "935006";
const NUMBER_WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine"];

const PROBES: Probe[] = [
  {
    id: "offer-counter",
    instructions:
      'Answer as the TENANT. When asked, COUNTER with: "I want nine hundred and sixty dollars, ' +
      'and the landlord provides an itemized deduction list." Do not accept.',
    task:
      "You are a caller for Caucus, a neutral mediation service. You are a neutral go-between: " +
      "convey information faithfully and never take sides.\n" +
      `Call ${to}. You are calling the tenant about a disputed security deposit. The total in ` +
      "dispute is $1,200.\n" +
      "Convey the other party's current proposal exactly as stated, without commentary: the " +
      'landlord proposes to settle for $700. Their proposal includes this condition, in their ' +
      'words: "tenant returns both mailbox keys". Reasoning they agreed to share: "The carpet ' +
      'replacement had a real cost."\n' +
      "Ask how the callee responds: do they accept, reject, or counter with a different amount? " +
      "If they counter, capture the exact amount and any conditions in their own words.\n" +
      "Never pressure the callee, never advise them, never predict outcomes, never make legal " +
      "claims. If asked for advice, say you cannot advise either party. Then thank them and end.",
    resultSchema: offerRelaySchema(1200),
    check: (structured, transcript) => {
      const parsed = parseOffer(structured);
      if (parsed === null) return "structured result did not parse against offerRelaySchema";
      if (parsed.offer_kind !== "counter") return `offer_kind was "${parsed.offer_kind}", expected "counter"`;
      if (parsed.amount_dollars !== 960) return `amount_dollars was ${parsed.amount_dollars}, expected 960`;
      const conditions = (parsed.conditions ?? []).join(" ").toLowerCase();
      if (!conditions.includes("itemiz")) return `condition not captured (got: ${JSON.stringify(parsed.conditions)})`;
      return neutralityDefect(transcript);
    },
  },
  {
    id: "offer-accept",
    instructions: 'Answer as the TENANT and simply ACCEPT: "Yes, I accept that." Add no conditions.',
    task:
      "You are a caller for Caucus, a neutral mediation service. You are a neutral go-between.\n" +
      `Call ${to}. Convey the other party's proposal exactly: the landlord proposes to settle ` +
      'for $700, with this condition in their words: "tenant returns both mailbox keys".\n' +
      "Ask whether the callee accepts, rejects, or counters. Capture their answer exactly. " +
      "Never advise or pressure them. Thank them and end the call.",
    resultSchema: offerRelaySchema(1200),
    check: (structured, transcript) => {
      const parsed = parseOffer(structured);
      if (parsed === null) return "structured result did not parse against offerRelaySchema";
      if (parsed.offer_kind !== "accept") return `offer_kind was "${parsed.offer_kind}", expected "accept"`;
      return neutralityDefect(transcript);
    },
  },
  {
    id: "code-echo",
    instructions:
      "Say ONLY \"Hello\" and then WAIT. Do NOT say any numbers until the agent has read you a " +
      "6-digit code — you are simulating a real callee, who cannot know the code in advance. " +
      "When it reads the code, repeat it back as digits, let it finish asking first, then say " +
      "\"Yes, I agree.\"",
    task:
      "You are a caller for Caucus, a neutral mediation service confirming a settlement.\n" +
      `Call ${to}. Read the settlement terms exactly, with no additions: a settlement of $700, ` +
      'with these conditions, stated verbatim: "tenant returns both mailbox keys".\n' +
      "Only after the terms have been read, state the confirmation code for this settlement. " +
      "Say it clearly, DIGIT BY DIGIT, with a short pause between digits. Never run the digits " +
      `together as one number, a year, or a pair of numbers. Say the code digit by digit: "${CODE}".\n` +
      "Then ask the callee, in plain words, to read that confirmation code back to you, digit by " +
      "digit. Ask explicitly and wait for it.\n" +
      "Capture the read-back verbatim, exactly as the callee speaks it, whether they say digits or " +
      "number words. Do not correct it, do not complete it, and never fill in a digit they did not say.\n" +
      "Only after the read-back, ask whether they agree to settle on exactly these terms.",
    resultSchema: attestationSchema(),
    check: (structured) => {
      const parsed = parseAttestation(structured);
      if (parsed === null) return "structured result did not parse against attestationSchema";
      const v = verifySpokenCode(CODE, parsed.phrase_spoken);
      if (!v.match) return `code not verifiable: heard "${parsed.phrase_spoken}" -> digits "${v.digits}"`;
      if (parsed.agrees_to_terms !== "yes") return `agrees_to_terms was "${parsed.agrees_to_terms}"`;
      return null;
    },
  },
  {
    id: "code-retry",
    instructions:
      "Say ONLY \"Hello\" and WAIT for the agent to read the code. Then DELIBERATELY get one " +
      "digit WRONG on your first read-back (e.g. change the last digit). The agent should notice " +
      "and re-read the code; on the second attempt read it back CORRECTLY as number words. Then " +
      "say \"Yes, I agree.\" This tests the retry path, so the FINAL attempt is what must match.",
    task:
      "You are a caller for Caucus, a neutral mediation service confirming a settlement.\n" +
      `Call ${to}. State the confirmation code clearly, DIGIT BY DIGIT, as two groups of three ` +
      `with a pause between the groups: "${CODE}". Then ask the callee to read the code back.\n` +
      "The code has six digits: count as they speak, stay silent until you have heard all six, " +
      "and never interrupt a read-back in progress.\n" +
      "Check the read-back against the code yourself. If it does not match exactly, do NOT say " +
      "which digit was wrong — say politely that you will read it once more, state it again digit " +
      "by digit, and ask for another read-back. Allow at most two extra attempts.\n" +
      "Capture the callee's FINAL, most complete attempt verbatim, whether digits or number words. " +
      "Then ask whether they agree to the settlement terms.",
    resultSchema: attestationSchema(),
    check: (structured) => {
      const parsed = parseAttestation(structured);
      if (parsed === null) return "structured result did not parse against attestationSchema";
      const v = verifySpokenCode(CODE, parsed.phrase_spoken);
      if (!v.match) return `final read-back after retry did not match: heard "${parsed.phrase_spoken}" -> digits "${v.digits}"`;
      return null;
    },
  },
];

const selected =
  values.only === undefined ? PROBES : PROBES.filter((p) => p.id.startsWith(values.only!));

console.log(`\nGate A4 physics test — ${selected.length} REAL calls to ${to}\n`);

const results: { id: string; defect: string | null; confidence?: number }[] = [];

for (const probe of selected) {
  console.log(`\n─── ${probe.id} ───`);
  console.log(`WHEN THE PHONE RINGS: ${probe.instructions}`);
  console.log("dialing...");

  try {
    const call = await client.calls.createAndWait(
      { task: probe.task, resultSchema: probe.resultSchema },
      { idempotencyKey: `physics:${probe.id}:${runId}` },
    );
    const transcript = (call.recipients ?? [])
      .flatMap((r: any) => r.attempts ?? [])
      .flatMap((a: any) => a.transcriptTurns ?? [])
      .map((t: any) => `${t.speaker}: ${t.text}`)
      .join("\n");

    const defect = probe.check(call.structuredResult, transcript);
    results.push({
      id: probe.id,
      defect,
      confidence: call.completionConfidence?.score,
    });

    console.log(`structured: ${JSON.stringify(call.structuredResult)}`);
    console.log(`confidence: ${call.completionConfidence?.score ?? "n/a"}`);
    console.log(defect === null ? "RESULT: clean ✅" : `RESULT: DEFECT — ${defect}`);
    console.log("--- transcript ---\n" + transcript);
  } catch (err) {
    results.push({ id: probe.id, defect: `call threw: ${String(err)}` });
    console.log(`RESULT: ERROR — ${String(err)}`);
  }
}

const clean = results.filter((r) => r.defect === null).length;
const pct = results.length === 0 ? 0 : Math.round((clean / results.length) * 100);
console.log(`\n═══ Gate A4: ${clean}/${results.length} clean (${pct}%) ═══`);
for (const r of results) {
  console.log(` ${r.defect === null ? "✅" : "❌"} ${r.id}${r.defect === null ? "" : ` — ${r.defect}`}`);
}
console.log(
  pct >= 80
    ? "\nGATE A4 PASS — Caucus locked, proceed to Phase C."
    : "\nGATE A4 FAIL — iterate the prompts once, then pivot to Recheck per FINAL-CONCEPT.md.",
);

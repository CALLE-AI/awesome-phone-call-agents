/**
 * What does the call counter actually count?
 *
 * The platform exposes no usage endpoint. `apps/python/leash/README.md` records
 * the dead ends: /v1/account, /v1/balance, /v1/credits, /v1/usage and /v1/me all
 * 404. The same file leaves the question open: "A no-answer is assumed to
 * consume a credit; the platform does not document whether it does."
 *
 * It can be read. Validation of the payload shape runs BEFORE the rate limiter,
 * but destination screening runs AFTER it. So a well-formed create aimed at an
 * unsupported region returns one of two things:
 *
 *   under the cap   422 call_not_ready   (no call placed)
 *   at the cap      429 rate_limit_exceeded, details { limit, window_hours, count }
 *
 * That is the oracle. It reads the counter without placing a call, and it only
 * reports once the cap is reached, so it measures by walking into the ceiling
 * rather than by asking.
 *
 * This script consumes the whole daily allowance on purpose. It is the
 * measurement, not a utility. Arms are ordered cheapest-first so that if the
 * cap arrives early, the arms already completed still carry their reading.
 *
 *   arm 1  rejected create   unsupported region, no call is ever placed
 *   arm 2  unroutable        reserved fictional number, fails at dial
 *   arm 3  connects          a real destination that answers
 *
 * Each arm records the counter before and after, so consumption per outcome is
 * a subtraction rather than an inference.
 *
 * Run with --i-understand-this-consumes-the-daily-allowance.
 */

import { CalleClient } from "@call-e/calle";
import { writeFile } from "node:fs/promises";
import { unsupportedDestination } from "../src/unsupported-destination.ts";

const UNROUTABLE = { phone: "+14155550100", region: "US", locale: "en-US" };

const TASK = "Ask whether the person can hear the call clearly, thank them, and end the call.";
const SCHEMA = {
  type: "object",
  required: ["heard_clearly"],
  properties: {
    heard_clearly: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Use unknown when the recipient did not answer the question.",
    },
  },
  additionalProperties: false,
};

type ApiError = Error & { code?: string; status?: number; details?: Record<string, unknown> };
type Reading = { at: string; count: number | null; limit: number | null; note: string };

const apiKey = process.env.CALLE_API_KEY ?? "";
if (apiKey === "") throw new Error("CALLE_API_KEY must be set.");
if (!process.argv.includes("--i-understand-this-consumes-the-daily-allowance")) {
  throw new Error(
    "This measurement deliberately walks into the 24-hour cap. " +
      "Re-run with --i-understand-this-consumes-the-daily-allowance.",
  );
}

const UNSUPPORTED_DEST = unsupportedDestination();
const UNSUPPORTED = {
  phone: UNSUPPORTED_DEST.phones[0] as string,
  region: UNSUPPORTED_DEST.region,
  locale: UNSUPPORTED_DEST.locale,
};

const client = new CalleClient({ apiKey });
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const log: unknown[] = [];

/** Reads the counter without placing a call. Returns nulls while under the cap. */
async function readCounter(): Promise<Reading> {
  const at = new Date().toISOString();
  try {
    await client.calls.create(
      {
        task: TASK,
        recipients: [{ phones: [UNSUPPORTED.phone], region: UNSUPPORTED.region, locale: UNSUPPORTED.locale }],
        recipientResultSchema: SCHEMA,
        metadata: { probe: "meter-oracle", run: runId },
      },
      { idempotencyKey: `meter-oracle-${runId}-${Date.now()}` },
    );
    return { at, count: null, limit: null, note: "create was ACCEPTED, which should not happen for an unsupported region" };
  } catch (error) {
    const e = error as ApiError;
    if (e.code === "rate_limit_exceeded") {
      const d = e.details ?? {};
      return { at, count: Number(d.count), limit: Number(d.limit), note: "at the cap, counter readable" };
    }
    return { at, count: null, limit: null, note: `under the cap: ${e.status} ${e.code}` };
  }
}

async function place(label: string, dest: { phone: string; region: string; locale: string }) {
  const before = await readCounter();
  let outcome: Record<string, unknown>;
  try {
    const created = await client.calls.create(
      {
        task: TASK,
        recipients: [{ phones: [dest.phone], region: dest.region, locale: dest.locale }],
        recipientResultSchema: SCHEMA,
        metadata: { probe: "meter", arm: label, run: runId },
      },
      { idempotencyKey: `meter-${label}-${runId}-${Date.now()}` },
    );
    let call = created;
    for (let i = 0; i < 24; i += 1) {
      if (call.status !== "queued" && call.status !== "in_progress") break;
      await new Promise((r) => setTimeout(r, 10_000));
      call = await client.calls.get(created.id);
    }
    const recipient = call.recipients[0];
    const attempt = recipient?.attempts.at(-1);
    outcome = {
      accepted: true,
      id: call.id,
      status: call.status,
      failureCode: attempt?.failureCode ?? null,
      turns: attempt?.transcriptTurns.length ?? 0,
      attemptsReported: recipient?.attempts.length ?? 0,
      structuredResult: recipient?.structuredResult ?? null,
    };
  } catch (error) {
    const e = error as ApiError;
    outcome = { accepted: false, status: e.status, code: e.code, details: e.details ?? null };
  }
  const after = await readCounter();
  const delta = before.count !== null && after.count !== null ? after.count - before.count : null;

  process.stdout.write(`\n[${label}]\n`);
  process.stdout.write(`  before  ${before.count ?? "-"} (${before.note})\n`);
  process.stdout.write(`  outcome ${JSON.stringify(outcome)}\n`);
  process.stdout.write(`  after   ${after.count ?? "-"} (${after.note})\n`);
  process.stdout.write(`  delta   ${delta ?? "not readable yet, still under the cap"}\n`);

  log.push({ arm: label, destination: dest.phone, before, outcome, after, delta });
}

const testPhone = process.env.CALLE_TEST_PHONE ?? "";

await place("rejected-create", UNSUPPORTED);
await place("unroutable", UNROUTABLE);
if (testPhone !== "") {
  await place("connects", {
    phone: testPhone,
    region: process.env.CALLE_TEST_REGION ?? "US",
    locale: process.env.CALLE_TEST_LOCALE ?? "en-US",
  });
} else {
  process.stdout.write("\n[connects] skipped: CALLE_TEST_PHONE is not set.\n");
}

const path = `probe-results/EVIDENCE-meter-${runId}.json`;
await writeFile(path, JSON.stringify({ captured: new Date().toISOString(), log }, null, 2), "utf8");
process.stdout.write(`\nSaved to ${path}\n`);

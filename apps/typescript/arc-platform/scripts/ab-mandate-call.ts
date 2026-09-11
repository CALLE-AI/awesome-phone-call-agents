/**
 * Read a CALL-E call back after the fact - task prompt, queue, talk time,
 * transcript turns, structured result - without dialling anyone.
 *
 *   set -a; . ./.env.local; set +a
 *   node_modules/.bin/jiti scripts/ab-mandate-call.ts --fetch call_abc [call_def]
 *
 * Two ids print a side-by-side. It reads CALL-E and prints; it writes NOTHING
 * to our database. DELIBERATELY NOT under tests/ and not named *.test.ts.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHY IT NO LONGER DIALS
 *
 * It began as an A/B harness: two real calls to one number, one carrying a
 * negotiation mandate and one not, to find out whether the mandate changed
 * what came back. That experiment is gone - the mandate was reverted on
 * 1 September - but what the harness learned about CALL-E's queue is worth
 * keeping, because all of it still applies to the calls the app places.
 *
 *   1. The client is not the owner of a call. A leg placed at 12:26:37Z was
 *      abandoned at the 20-minute wall and then dialled anyway at 12:55:32Z,
 *      29 minutes after we stopped waiting. Whatever a browser tab decides,
 *      the call happens. That is why /api/calle/reconcile exists, and why
 *      this reader exists: without it, a result that arrives late is simply
 *      never collected.
 *
 *   2. "One call at a time" is only true while the queue is shorter than the
 *      wall. The abandoned leg landed 1.4 seconds after an unrelated call to
 *      the same handset and both came back SIP 486 Busy Here. The harness
 *      caused the collision that app/api/calle/batch/route.ts de-duplicates
 *      against - not by dialling twice, but by giving up once.
 *
 *   3. There is no way to call a queued task off. `/v1/calls` exposes POST and
 *      GET only; `canceled` is a status CALL-E can set and we cannot. An
 *      abandoned call can only be waited out. Before dialling a number again,
 *      read back the previous ids and check each one is terminal.
 *
 *   4. `call.started` is not the dial. `call.in_progress` is. On the 25 August
 *      baseline they are two seconds apart, which hides the difference; on
 *      1 September they were 20 seconds and 6208 seconds. Reading the first
 *      event as the dial reports a 105-minute queue as twenty seconds.
 *
 * The dial half is deleted rather than left behind a flag: a script that can
 * place real calls is one somebody eventually runs by accident.
 * ---------------------------------------------------------------------------
 *
 * Run with jiti rather than tsx: `@call-e/calle` publishes an ESM-only exports
 * map that tsx resolves through the CJS loader and fails on. (jiti arrives as
 * a transitive dependency of next/eslint. If a future install drops it, run
 * the file through any TS runner that handles ESM.)
 */
import { CalleClient, type Call } from "@call-e/calle";

import { calleGetCall, calleDiagnostics, resolveCalleBaseUrl } from "../lib/calle";
import { deepMaskPhones } from "../lib/mask";
import { scoreRow, type CallTarget, type CampaignContext } from "../lib/calle-media";

/* Only the budget matters to scoreRow here; the rest of a campaign's context
   cannot be recovered from a call record and is not needed to read one. */
const context: CampaignContext = { budgetTotal: 450_000, currency: "PKR" };

interface CallReport {
  label: string;
  callId: string;
  status: string;
  done: boolean;
  queueDirectS: number | null;
  queueDerivedS: number | null;
  queueEventsS: number | null;
  talkS: number | null;
  turns: number;
  result: Record<string, unknown> | null;
  rateField: string;
  rateIsNumber: boolean;
  rate: number | null;
  providerCallId: string | null;
  failure: string | null;
}

const rule = (s: string) => console.log(`\n${"=".repeat(72)}\n${s}\n${"=".repeat(72)}`);
const secs = (a?: string | null, b?: string | null) =>
  a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null;

/**
 * Does this timestamp say what clock it is on?
 *
 * Call tasks are ISO-8601 with a `Z`. Attempts are not: they arrive as
 * bare local timestamps, consistently UTC−4 (our provider write-up,
 * §2). Date.parse reads a bare string in the RUNNING MACHINE's timezone, so
 * subtracting one from a `Z` timestamp gives an answer that depends on where
 * the script is run - correct on the UTC−4 laptop this was written on, hours
 * wrong anywhere else, and silently so either way.
 *
 * Differences BETWEEN two bare attempt timestamps are still sound, whatever
 * the offset is, because it cancels: talk time survives. Mixing the two clocks
 * does not, so that measurement is withheld rather than guessed.
 */
const hasTz = (s: string) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(s.trim());
const show = (n: number | null, unit = "s") => (n === null ? "—" : `${n}${unit}`);
const money = (n: number | null) => (n === null ? "—" : `PKR ${n.toLocaleString()}`);

function usage(msg: string): never {
  console.error(`\n${msg}\n`);
  console.error("Usage: node_modules/.bin/jiti scripts/ab-mandate-call.ts --fetch call_abc [call_def]\n");
  process.exit(1);
}

function client(): CalleClient {
  const key = process.env.CALLE_API_KEY;
  if (!key) usage("CALLE_API_KEY is not set — this script only talks to the real CALL-E.");
  /* Through the allowlist, not straight from the environment. This script
     builds its own client, so the check in lib/calle.ts never ran for it and
     the key went wherever CALLE_BASE_URL pointed. */
  return new CalleClient({
    apiKey: key,
    baseUrl: resolveCalleBaseUrl(process.env.CALLE_BASE_URL),
  });
}

/**
 * What kind of target was this, station or creator?
 *
 * It decides which field holds the rate, and getting it wrong reads a real
 * result as an empty one: a creator call scored as a station looks for
 * `rate_per_spot`, finds nothing, and reports no rate on a call that returned
 * one. Our own calls say so in metadata; anything else is inferred from the
 * shape of the result, which is the only other honest source.
 */
function targetFrom(call: Call, result: Record<string, unknown> | null): CallTarget {
  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  const metaType = typeof meta.targetType === "string" ? meta.targetType : null;
  const inferred =
    result && ("rate_per_spot" in result || "spots_available" in result) ? "station" :
    result && ("rate" in result || "interested" in result) ? "creator" :
    null;
  const type = (metaType === "station" || metaType === "creator" ? metaType : inferred) ?? "station";
  return {
    name: typeof meta.name === "string" ? meta.name : "(unknown target)",
    type,
    audienceSize: typeof meta.audienceSize === "number" ? meta.audienceSize : undefined,
  };
}

async function fetchCall(callId: string, raw: CalleClient): Promise<CallReport> {
  let call: Call;
  try {
    call = await raw.calls.get(callId);
  } catch (e) {
    throw new Error(`${callId}: ${e instanceof Error ? e.message : e}`);
  }

  const state = await calleGetCall(callId);
  const attempt = call.recipients?.[0]?.attempts?.[0] ?? null;
  const talkS = secs(attempt?.startedAt, attempt?.completedAt);

  /* Three ways of measuring the same queue, because no one of them is
     trustworthy on its own:
       direct  - attempt.startedAt - call.createdAt
       derived - (completedAt - createdAt) - talk time, the method in
                 docs/calle-support.md
       events  - the provider's own event stream, the only one that timestamps
                 the dial on the same clock as the task
     Attempt timestamps have been seen on a different clock from the task, and
     attempts have reported zero duration for calls that ran for minutes, so
     when these disagree the disagreement IS the finding. */
  /* Only computable when the attempt says what clock it is on - see hasTz. */
  const attemptClockUnknown = Boolean(attempt?.startedAt && !hasTz(attempt.startedAt));
  const queueDirectS = attemptClockUnknown ? null : secs(call.createdAt, attempt?.startedAt);
  const total = secs(call.createdAt, call.completedAt);
  const queueDerivedS = total !== null && talkS !== null ? total - talkS : null;

  let events: { type: string; created_at: string }[] = [];
  try {
    const list = await raw.calls.listEvents(callId);
    events = (list.data ?? []) as unknown as { type: string; created_at: string }[];
  } catch (e) {
    console.log(`  (events unavailable: ${e instanceof Error ? e.message : e})`);
  }
  /* `call.started` is NOT the dial - see note 4 in the header. */
  const acceptEvent = events.find((e) => /start/i.test(e.type));
  const dialEvent = events.find((e) => /in_progress|dial|ring/i.test(e.type));
  const acceptS = secs(call.createdAt, acceptEvent?.created_at);
  const queueEventsS = secs(call.createdAt, dialEvent?.created_at);

  const result = state.structuredResult;
  const target = targetFrom(call, result);
  const rateField = target.type === "station" ? "rate_per_spot" : "rate";
  const rateIsNumber = typeof result?.[rateField] === "number";
  const row = result ? scoreRow(context, target, result) : null;
  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  const label = typeof meta.name === "string" ? `${meta.name} (${target.type})` : callId;

  rule(`FETCHED: ${label}`);
  console.log(`target type:       ${target.type} (${meta.targetType ? "from metadata" : "inferred from the result"})`);
  console.log("\n--- FULL TASK PROMPT AS SENT ---");
  console.log(call.task);
  console.log("--- END TASK PROMPT ---");

  console.log("\n--- OUTCOME ---");
  console.log(`call id:           ${callId}`);
  console.log(`status:            ${state.status}${state.failed ? " (failed)" : ""}`);
  console.log(`created:           ${call.createdAt}`);
  console.log(`completed:         ${call.completedAt ?? "— (still open)"}`);
  console.log(`task accepted:     ${show(acceptS)} after creation (call.started — not the dial)`);
  console.log(
    `queue before dial: direct ${show(queueDirectS)} | derived ${show(queueDerivedS)} | events ${show(queueEventsS)}`
  );
  if (attemptClockUnknown) {
    console.log(
      `  (direct withheld: attempt timestamp "${attempt!.startedAt}" carries no timezone,` +
      " so subtracting it from the task's UTC clock would depend on where this ran)"
    );
  }
  console.log(`talk time:         ${show(talkS)}`);
  console.log(`transcript turns:  ${state.transcriptTurns}`);
  if (talkS === 0 && state.transcriptTurns > 0) {
    console.log("  !! zero-duration attempt with a transcript — the §2 reporting bug, not a short call");
  }
  if (attempt === null) console.log("  !! no attempt on record — this task was never dialled");
  if (events.length) {
    console.log("events:");
    for (const e of events) {
      console.log(`  +${String(secs(call.createdAt, e.created_at) ?? "?").padStart(6)}s  ${e.type}`);
    }
  }
  console.log(
    `${rateField} is a number: ${rateIsNumber ? "YES" : "NO"}` +
    (result && !rateIsNumber ? ` (got ${JSON.stringify(result[rateField])})` : "")
  );
  /* A number here is not the same as the RIGHT number. One creator call
     returned rate: 8000, well-formed and schema-valid, for a package the
     speaker had priced at 18,000 - the digits were lost in ASR and the cheaper
     deliverable was the only one heard (docs/calle-support.md §4). Read the
     result against the notes field before believing a figure. */
  console.log("structured result:");
  /* The provider's payload, whole. Masked: a terminal scrollback is
     written down the same way a platform log is. */
  console.log(result ? JSON.stringify(deepMaskPhones(result), null, 2) : "  (none)");
  if (state.summary) console.log(`summary: ${deepMaskPhones(state.summary)}`);

  return {
    label,
    callId,
    status: state.status,
    done: state.done,
    queueDirectS,
    queueDerivedS,
    queueEventsS,
    talkS,
    turns: state.transcriptTurns,
    result,
    rateField,
    rateIsNumber,
    rate: row?.price ?? null,
    providerCallId: attempt?.providerCallId ?? null,
    failure: attempt?.failureCode ?? call.failureCode ?? null,
  };
}

function sideBySide(a: CallReport, b: CallReport) {
  rule("SIDE BY SIDE");
  const rows: [string, string, string][] = [
    ["", a.label, b.label],
    ["status", a.status, b.status],
    ["queue (direct)", show(a.queueDirectS), show(b.queueDirectS)],
    ["queue (derived)", show(a.queueDerivedS), show(b.queueDerivedS)],
    ["queue (events)", show(a.queueEventsS), show(b.queueEventsS)],
    ["talk time", show(a.talkS), show(b.talkS)],
    ["transcript turns", String(a.turns), String(b.turns)],
    ["rate a number", `${a.rateIsNumber ? "yes" : "no"} (${a.rateField})`,
      `${b.rateIsNumber ? "yes" : "no"} (${b.rateField})`],
    ["rate", money(a.rate), money(b.rate)],
    ["call id", a.callId, b.callId],
    ["provider call id", a.providerCallId ?? "—", b.providerCallId ?? "—"],
    ["failure code", a.failure ?? "—", b.failure ?? "—"],
  ];
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  for (const [k, v1, v2] of rows) console.log(`${k.padEnd(w0)}  ${v1.padEnd(w1)}  ${v2}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--fetch")) usage("This script only reads calls back. Pass --fetch <callId>.");

  const ids = args.slice(args.indexOf("--fetch") + 1).filter((a) => !a.startsWith("-"));
  if (!ids.length) usage("--fetch needs at least one call id.");

  const raw = client();

  rule("READ BACK — no calls placed");
  console.log("diagnostics:", JSON.stringify(calleDiagnostics()));
  console.log("call ids:   ", ids.join(", "));

  const reports: CallReport[] = [];
  for (const id of ids) {
    try {
      reports.push(await fetchCall(id, raw));
    } catch (e) {
      console.error(`\n!! ${e instanceof Error ? e.message : e}`);
    }
  }

  if (reports.length === 2) sideBySide(reports[0], reports[1]);
  else if (reports.length > 2) console.log("\n(more than two calls — no side-by-side; read them above)");
  if (!reports.length) process.exit(1);

  const open = reports.filter((r) => !r.done);
  if (open.length) {
    console.log(
      `\n${open.length} of these has not reached a terminal state. It has not been cancelled — ` +
      "there is no way to cancel it — so it may still be dialled:\n  " +
      open.map((r) => r.callId).join("\n  ") +
      "\nDo not place another call to that number until it is terminal."
    );
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});

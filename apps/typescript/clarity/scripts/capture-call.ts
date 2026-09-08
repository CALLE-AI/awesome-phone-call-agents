/**
 * Capture one real CALL-E call using the same brief and schema as the app.
 *
 *   npm run call:capture -- --consent  # calls the agreed DEMO_PHONE_E164
 *   npm run call:preview  # prints the brief and schema without dialing
 *
 * The raw response goes to data/captures/<timestamp>.json (gitignored). That file
 * is the candidate for fixtures/golden-run.json.
 *
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import demo from "../fixtures/demo-application.json" with { type: "json" };
import clarifications from "../fixtures/demo-clarifications.json" with { type: "json" };
import { buildResultSchema, buildTask, calleClient } from "../lib/calle";
import { formatOffset, matchEvidence, normalizeCall, readAnswer } from "../lib/call-record";
import type { Clarification } from "../lib/types";
import { destination, maskPhone } from "../lib/phone";
import { operatorId } from "../lib/auth";
import { authorizeDestination, CallProblem, callError, startLiveCall } from "../lib/live-call";
import { createSession } from "../lib/session";

/** The ambiguities in the seeded application, ranked. Shared with the replay
 *  fixtures so a promoted run stays keyed to the same questions. Only the first
 *  is called about, exactly as in the product. */
const CLARIFICATIONS = clarifications as Clarification[];
const PRIMARY = CLARIFICATIONS[0]!;

async function main() {
  const dryRun = process.argv.includes("--dry");
  const phone = process.env.DEMO_PHONE_E164 ?? "";

  const task = buildTask(PRIMARY, { candidateName: demo.candidateName, roleTitle: demo.roleTitle });
  const resultSchema = buildResultSchema(PRIMARY);

  if (dryRun) {
    console.log("=== TASK ===\n");
    console.log(task);
    console.log("\n=== RESULT SCHEMA ===\n");
    console.log(JSON.stringify(resultSchema, null, 2));
    return;
  }

  try { destination(phone); }
  catch (error) { throw new CallProblem((error as Error).message, 400); }
  if (!process.argv.includes("--consent")) throw new CallProblem("Pass --consent only after verifying this exact destination and the recipient's agreement to the English AI call.", 400);
  const client = calleClient();
  const started = Date.now();
  const owner = operatorId();
  const session = await createSession({ application: demo, clarifications: CLARIFICATIONS, ownerId: owner });
  await authorizeDestination(session.id, owner, phone);
  console.log(`Session: ${session.id}. Placing call to ${maskPhone(phone)} …`);
  console.log("If acceptance is unknown, stop and reconcile this session; do not rerun capture.");
  const accepted = await startLiveCall(session.id, owner);
  const created = await client.calls.get(accepted.callId);

  console.log(`call_id=${created.id}  status=${created.status}`);
  console.log("Answer the phone and role-play the candidate. Polling …\n");

  let last = "";
  let seenEvents = 0;
  let call = created;

  while (!["completed", "failed", "canceled"].includes(call.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    call = await client.calls.get(created.id);

    const attempt = call.recipients[0]?.attempts.at(-1);
    const line = `${elapsed(started)}  status=${call.status}  attempt=${attempt?.status ?? "-"}  turns=${attempt?.transcriptTurns.length ?? 0}`;
    if (line.slice(8) !== last.slice(8)) {
      console.log(line);
      last = line;
    }

    try {
      const events = await client.calls.listEvents(created.id);
      for (const event of events.data.slice(seenEvents)) {
        console.log(`  event ${event.type} (${event.level}): ${event.message}`);
      }
      seenEvents = Math.max(seenEvents, events.data.length);
    } catch {
      // Events are diagnostics; never let them stop the poll loop.
    }
  }

  const totalMs = Date.now() - started;
  console.log(`\nTerminal after ${elapsed(started)} (${totalMs} ms).`);

  const runPath = path.join(process.cwd(), "data", "captures", `${stamp()}.json`);
  await fs.mkdir(path.dirname(runPath), { recursive: true });
  await fs.writeFile(runPath, JSON.stringify(call, null, 2), "utf8");
  console.log(`Raw response → ${path.relative(process.cwd(), runPath)}`);

  report(call, totalMs);
}

function report(call: Awaited<ReturnType<ReturnType<typeof calleClient>["calls"]["get"]>>, totalMs: number) {
  const record = normalizeCall(call);

  console.log("\n=== CALL RESULT ===\n");

  console.log(`End-to-end latency: ${(totalMs / 1000).toFixed(1)}s from POST to terminal.`);

  console.log(`\nEvidence — ${record.taskEvidence.length} item(s):`);
  for (const item of record.taskEvidence) console.log(`   • ${item}`);

  console.log(`\nTranscript — ${record.transcript.length} turn(s):`);
  for (const turn of record.transcript) {
    const at = formatOffset(turn.offsetSeconds) ?? "--:--";
    console.log(`   [${at}] ${turn.speaker.padEnd(7)} ${turn.text}`);
  }

  console.log("\nStructured result:");
  console.log(JSON.stringify(record.structuredResult, null, 2));

  console.log("\n================ THE REVEAL ================");
  const answer = readAnswer(record.structuredResult, PRIMARY.id);
  const evidence = answer ? matchEvidence(answer.quote, record.transcript) : null;
  console.log(`\nBEFORE         ${PRIMARY.topic ?? PRIMARY.claim}`);
  console.log(`AFTER          ${answer?.corrected ?? "(no answer extracted)"}`);
  console.log(`               ${answer?.correction ?? "-"}`);
  console.log(`               ${answer?.basis || "-"}`);
  console.log(`\nWRITTEN CLAIM  "${PRIMARY.claim}"`);
  console.log(`WE ASKED       "${PRIMARY.question}"`);
  console.log(`CLARIFIED      ${answer?.answer ?? "-"}`);
  console.log(`SPECIFICS      ${answer?.specifics ?? "-"}`);
  const at = formatOffset(evidence?.offsetSeconds ?? null);
  console.log(`EVIDENCE       "${evidence?.quote ?? "-"}"${at ? `  [${at}]` : "  (unmatched)"}`);
  console.log(`STILL UNCLEAR  ${answer?.still_unclear ?? "-"}`);
  console.log(`CONFIDENCE     ${answer?.confidence ?? "-"}`);

  console.log(`\nsummary: ${record.summary ?? "-"}`);
  console.log(`taskCompleted: ${record.taskCompleted}  confidence: ${JSON.stringify(record.completionConfidence)}`);
  if (record.failureCode) console.log(`failure: ${record.failureCode} — ${record.failureMessage}`);
}

function elapsed(from: number): string {
  const s = Math.floor((Date.now() - from) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

main().catch((error) => {
  console.error(callError(error).error);
  process.exit(1);
});

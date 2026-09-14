import { CalleClient } from "@call-e/calle";
import { fixtureBrief, fixtureCandidates } from "../lib/fixtures.ts";
import { evaluateCenter } from "../lib/matching.ts";
import { parseCenterResult } from "../lib/result-schema.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const callId = argument("--call-id") ?? process.env.TINYSLOT_PROOF_CALL_ID?.trim();
const candidateId = argument("--candidate") ?? "willow-room";
const apiKey = process.env.CALLE_API_KEY?.trim();

if (!apiKey) {
  console.error("CALLE_API_KEY is missing from .env.local.");
  process.exit(1);
}
if (!callId || !/^call_[A-Za-z0-9_-]{8,160}$/.test(callId)) {
  console.error("Provide a valid CALL-E ID with --call-id call_... or TINYSLOT_PROOF_CALL_ID.");
  process.exit(1);
}

const candidate = fixtureCandidates.find((item) => item.id === candidateId);
if (!candidate) {
  console.error("The candidate must be one of TinySlot's reviewed fixture candidate IDs.");
  process.exit(1);
}

const client = new CalleClient({ apiKey });
let call;
let lastError;
for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    call = await client.calls.get(callId);
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

if (!call) {
  console.error(`Unable to retrieve the existing call after bounded retries: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
  process.exit(1);
}

const recipient = call.recipients[0];
const structuredResult = parseCenterResult(recipient?.structuredResult);
const evaluation = evaluateCenter(candidate, structuredResult, fixtureBrief);
const confidence = call.completionConfidence;
const confidenceScore = confidence?.score ?? null;
const confidenceLabel = confidence?.label ?? "unknown";
const passedChecks = evaluation.checks.filter((check) => check.status === "pass").length;
const failedChecks = evaluation.checks.filter((check) => check.status === "fail").length;
const unknownChecks = evaluation.checks.filter((check) => check.status === "unknown").length;
const transcriptTurnCount = recipient?.attempts.reduce((total, attempt) => total + attempt.transcriptTurns.length, 0) ?? 0;

const rows = [
  ["Provider", "CALL-E Developer API"],
  ["Call ID", call.id],
  ["Status", call.status],
  ["Task completed", call.taskCompleted === true ? "true" : String(call.taskCompleted)],
  ["Confidence", confidenceScore === null ? confidenceLabel : `${confidenceLabel} (${confidenceScore.toFixed(2)})`],
  ["Structured schema", structuredResult ? "PASS" : "FAIL"],
  ["TinySlot verdict", evaluation.tier.toUpperCase()],
  ["Deterministic checks", `${passedChecks} pass / ${failedChecks} fail / ${unknownChecks} unknown`],
  ["Provider evidence items", String(call.evidence.length)],
  ["Transcript turns", String(transcriptTurnCount)],
  ["Retrieved at", new Date().toISOString()],
];

const width = Math.max(...rows.map(([label]) => label.length));
console.log("\nTINYSLOT LIVE CALL-E PROOF");
console.log("Read-only retrieval. No call was created. No phone or transcript is printed.\n");
for (const [label, value] of rows) console.log(`${label.padEnd(width)} : ${value}`);

const valid = call.status === "completed"
  && call.taskCompleted === true
  && structuredResult !== null
  && failedChecks === 0
  && unknownChecks === 0;
console.log(`\nProof result${" ".repeat(Math.max(1, width - 11))} : ${valid ? "PASS" : "REVIEW"}`);
if (!valid) process.exitCode = 2;

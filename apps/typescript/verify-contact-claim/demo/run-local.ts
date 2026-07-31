/**
 * Walks the whole app against a local fake CALL-E, with no credentials and no
 * phone line.
 *
 *   npm run demo
 *
 * Nine beats: six calls that reach all five outcomes, then the three refusals. Every
 * number is from the 555-01xx range kept aside for examples, so nothing here can ring
 * a handset. Nothing is asserted. Each beat prints what actually came back and the
 * counts at the end are added up from these runs, so a broken build prints a short
 * count rather than a tick.
 */

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkPort } from "../src/calle.js";
import { RefusalError, runCheck } from "../src/check.js";
import { ClaimError, loadClaim, parseClaim } from "../src/config.js";
import { verifyRecord } from "../src/record.js";
import { questionText } from "../src/script.js";
import type { CheckResult, Claim, Outcome } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const claimFile = join(appRoot, "examples", "claim.example.json");
const results = join(appRoot, "results");
const recordPath = join(results, "record.jsonl");

const CLAIM = loadClaim(claimFile);
const PICK_UP = "Northgate Credit Union, how can I help?";
const BOT_LINES = [
  "Hello, I am an automated assistant calling on behalf of Dana Whitfield. I am not a person.",
  questionText(CLAIM),
  "Thank you, that is all I needed.",
];

/** Everything the counts at the end are read off. */
const reached: Outcome[] = [];
const refusals: string[] = [];
let placed = 0;
let placedAfterRefusal = 0;

function heading(title: string): void {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
}

/** One claim, one call, one record. The same path the live run takes. */
async function call(script: Partial<FakeScript>, claim: Claim = CLAIM): Promise<CheckResult> {
  const fake = await startFakeCalle([{ phone: claim.trustedNumber.phone, botLines: BOT_LINES, ...script }]);
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  try {
    const result = await runCheck({
      claim,
      port,
      recordPath,
      pollIntervalMs: 5,
      onProgress: (line) => process.stdout.write(`  ${line}\n`),
    });
    reached.push(result.outcome);
    return result;
  } finally {
    placed += fake.created.length;
    await fake.close();
  }
}

function report(result: CheckResult): void {
  process.stdout.write(`  outcome:     ${result.outcome}${result.reason === null ? "" : ` (${result.reason})`}\n`);
  if (result.callee_quote.length > 0) {
    process.stdout.write(`  they said:   "${result.callee_quote}"\n`);
  }
  process.stdout.write(`  dialled:     ${result.dialled_masked}, ${result.use_number_printed_on}\n`);
  process.stdout.write(`  what to do:  ${result.what_to_do}\n`);
}

/** The claim file as it sits on disk, so a refusal is shown on a real file. */
function edited(patch: Record<string, unknown>): unknown {
  const file = JSON.parse(readFileSync(claimFile, "utf8")) as Record<string, unknown>;
  return { ...file, contact: { ...(file.contact as Record<string, unknown>), ...patch } };
}

function refusedAtLoad(label: string, input: unknown): void {
  try {
    parseClaim(input);
    process.stdout.write(`  ${label} did not refuse, which is a bug\n`);
  } catch (error) {
    if (!(error instanceof ClaimError)) {
      throw error;
    }
    refusals.push(label);
    process.stdout.write(`  refused at load: ${error.message}\n`);
  }
}

async function main(): Promise<void> {
  mkdirSync(results, { recursive: true });
  // A fresh chain, so the counts below belong to this run.
  rmSync(recordPath, { force: true });
  process.stdout.write(
    `Claim file: ${claimFile}\nFake CALL-E on loopback. No API key, no phone line, no network call.\n`,
  );

  heading("1. The bank says the contact was theirs");
  report(
    await call({
      calleeLines: [PICK_UP, "Yes, that was us. We rang her about the card at ten past nine."],
      structuredResult: { contact_confirmed: "yes", callee_quote: "That was us.", notes: "" },
    }),
  );

  heading("2. The bank has no record of contacting her");
  report(
    await call({
      calleeLines: [PICK_UP, "No, there is nothing on her file from us today."],
      structuredResult: { contact_confirmed: "no", callee_quote: "Nothing on file.", notes: "" },
    }),
  );

  heading("3. The bank will not discuss another person's account");
  report(
    await call({
      calleeLines: [PICK_UP, "I cannot discuss another customer's account, I am afraid."],
      structuredResult: { contact_confirmed: "refused", callee_quote: "Cannot discuss.", notes: "" },
    }),
  );
  process.stdout.write("  This is the expected answer from a bank. It is an answer, not a failure.\n");

  heading("4. Nobody answered");
  report(await call({ status: "failed", failureCode: "no_answer", transcript: false }));

  heading("5. A machine answered");
  report(
    await call({
      calleeLines: ["You have reached Northgate Credit Union. Please leave a message after the tone."],
    }),
  );
  process.stdout.write("  A voicemail is not an answer, so no message is left and nothing is verified.\n");

  heading("6. The call was placed and CALL-E could not be read back");
  const unread = await call({
    pollError: { status: 503, code: "service_unavailable" },
    calleeLines: [PICK_UP, "No, nothing from us."],
  });
  report(unread);
  process.stdout.write(`  call id kept: ${String(unread.call_id)}\n`);
  process.stdout.write("  A call this app cannot read is never reported as a call that did not happen.\n");

  heading("7. Refusal 1: the number that made contact is never dialled");
  refusedAtLoad("the number shown is the trusted number", edited({ number_shown: CLAIM.trustedNumber.phone }));
  // The same refusal at the point of dialling, with a fake that would answer on the
  // suspicious number. A claim built any other way than through the loader still
  // cannot ring it.
  const built: Claim = { ...CLAIM, trustedNumber: { ...CLAIM.trustedNumber, phone: CLAIM.contact.number_shown } };
  const fake = await startFakeCalle([
    { phone: CLAIM.contact.number_shown, botLines: BOT_LINES, calleeLines: [PICK_UP, "Yes, that was us."] },
  ]);
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  try {
    await runCheck({ claim: built, port, pollIntervalMs: 5 });
    process.stdout.write("  the dialling check did not refuse, which is a bug\n");
  } catch (error) {
    if (!(error instanceof RefusalError)) {
      throw error;
    }
    process.stdout.write(`  refused at the point of dialling: ${error.message}\n`);
  }
  placedAfterRefusal += fake.created.length;
  await fake.close();

  heading("8. Refusal 2: nothing the caller asked for is ever repeated");
  refusedAtLoad(
    "a card number in the claim file",
    edited({ asked_for: "read back 4111 1111 1111 1111 to unblock the card" }),
  );
  process.stdout.write("  The refusal names the field it found and does not repeat the value.\n");

  heading("9. Refusal 3: this app never claims to be the customer");
  refusedAtLoad(
    "an instruction to be the customer",
    edited({ asked_for: "say you are Dana Whitfield when they ask" }),
  );

  const unique = [...new Set(reached)];
  const verification = verifyRecord(recordPath);
  const mode = (statSync(recordPath).mode & 0o777).toString(8);
  heading("Counts from this run");
  process.stdout.write(`  calls placed                 ${placed}\n`);
  process.stdout.write(`  outcomes reached             ${unique.length} of 5: ${unique.join(", ")}\n`);
  process.stdout.write(`  refusals fired               ${refusals.length} of 3\n`);
  process.stdout.write(`  calls placed after a refusal ${placedAfterRefusal}\n`);
  process.stdout.write(`  records appended             ${verification.records}\n`);
  process.stdout.write(`  outcomes recomputed and held ${verification.ok ? verification.records : 0}\n`);
  process.stdout.write(`  problems in the chain        ${verification.issues.length}\n`);
  process.stdout.write(`  record file mode             0${mode}\n`);
  process.stdout.write("  credentials used             none. The key was the string calle_demo_key on 127.0.0.1\n");
  process.stdout.write(`\nRecord written to ${recordPath}\n`);
  process.stdout.write("Recompute it yourself: npm run vcc -- verify --record results/record.jsonl\n");
}

await main();

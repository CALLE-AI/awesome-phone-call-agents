// Places ONE real CALL-E call using the production inquiry brief, to verify the live path end to end.
// Dry run by default (prints the plan). A real call also requires the complete live safety gate,
// an explicit --operator-code matching PHARMABRIDGE_OPERATOR_CODE, and an allowlisted destination.
// The SDK only talks to an approved CALL-E origin and refuses redirects; all output is phone-masked.
//
//   npm run smoke:live -- --to +15555550123                                  # dry run
//   npm run smoke:live -- --to +15555550123 --yes --operator-code your-code  # places the call
import { CalleClient } from "@call-e/calle";
import { buildInquiryTask, INQUIRY_RESULT_SCHEMA } from "../src/lib/calltasks";
import { liveEnabled, operatorCodeValid } from "../src/lib/config";
import { isE164, maskPhone, redactDeep, redactPhones, regionFromE164 } from "../src/lib/phone";
import { calleBaseUrl, noRedirectFetch } from "../src/lib/transport";
import type { Medication, Pharmacy } from "../src/lib/types";

const args = process.argv.slice(2);
const to = args[args.indexOf("--to") + 1];
const confirmed = args.includes("--yes");
const locale = args.includes("--locale") ? args[args.indexOf("--locale") + 1] : undefined;
const operatorCode = args.includes("--operator-code") ? args[args.indexOf("--operator-code") + 1] : undefined;

function fail(message: string): never {
  console.error(`✖ ${redactPhones(message)}`);
  process.exit(1);
}

const apiKey = process.env.CALLE_API_KEY;
const allowlist = (process.env.PHARMABRIDGE_ALLOWED_NUMBERS ?? "").split(",").map((s) => s.trim());
if (!apiKey) fail("CALLE_API_KEY is missing (run via npm so .env.local is loaded).");
if (!isE164(to)) fail("Pass --to with an E.164 number, e.g. --to +15555550123");
if (!allowlist.includes(to)) fail(`${maskPhone(to)} is not on PHARMABRIDGE_ALLOWED_NUMBERS. Refusing to dial.`);

const medication: Medication = {
  rxcui: "308189",
  name: "Amoxicillin 400 mg/5 mL Oral Suspension",
  ingredient: "amoxicillin",
  brandNames: [],
  quantity: "one 100 mL bottle",
  alternatives: ["Amoxicillin 250 mg/5 mL Oral Suspension"],
  controlled: false,
  deaSchedule: null,
  urgency: "today",
};
const pharmacy: Pharmacy = {
  id: "smoke-test",
  name: "the pharmacy test line",
  brand: null,
  address: "n/a",
  lat: 0,
  lon: 0,
  distanceKm: 0,
  bearingDeg: 0,
  phone: to,
  phoneMasked: maskPhone(to),
  openingHours: null,
  kind: "pharmacy",
  source: "synthetic",
  mapsUrl: null,
  rating: null,
  openNow: null,
  signature: null,
};

const task = buildInquiryTask(medication, pharmacy);
console.log(`Destination: ${maskPhone(to)} (region ${regionFromE164(to) ?? "unknown"})\n`);
console.log("── Agent brief ──────────────────────────────\n" + redactPhones(task) + "\n");

if (!confirmed) {
  console.log("Dry run only. Re-run with --yes --operator-code <code> to place one real call.");
  process.exit(0);
}

if (!liveEnabled()) {
  fail("Live safety gate is incomplete. Set PHARMABRIDGE_LIVE_CALLS=true plus the required allowlist, operator code, and access-token secret.");
}
if (!operatorCodeValid(operatorCode)) {
  fail("Pass --operator-code with the value configured in PHARMABRIDGE_OPERATOR_CODE.");
}

// tsx compiles this file as an ES module; main() keeps error handling in one place.
async function main() {
  const client = new CalleClient({ apiKey: apiKey!, baseUrl: calleBaseUrl(), fetch: noRedirectFetch });
  const created = await client.calls.create(
    {
      task,
      recipients: [{ phones: [to], region: regionFromE164(to) ?? undefined, locale }],
      resultSchema: INQUIRY_RESULT_SCHEMA,
      metadata: { app: "pharmabridge", kind: "smoke" },
    },
    { idempotencyKey: `pharmabridge:smoke:${Date.now()}` },
  );
  console.log(`✔ Created ${created.id} (${created.status}). Waiting for the terminal result…`);

  const done = await client.calls.waitForResult(created.id, { intervalMs: 4000, timeoutMs: 10 * 60_000 });
  console.log(`\nStatus: ${done.status}  taskCompleted: ${done.taskCompleted}  confidence: ${JSON.stringify(done.completionConfidence)}`);
  if (done.failureCode) console.log(`Failure: ${done.failureCode} ${redactPhones(done.failureMessage ?? "")}`);
  console.log("\nSummary:", redactPhones(done.summary ?? ""));
  console.log("\nStructured result:", JSON.stringify(redactDeep(done.structuredResult ?? done.recipients[0]?.structuredResult ?? null), null, 2));
  console.log("\nEvidence:", redactDeep(done.evidence));
  for (const attempt of done.recipients.flatMap((r) => r.attempts)) {
    console.log(`\nAttempt ${attempt.id}: ${attempt.status}${attempt.providerCallId ? ` (provider ${attempt.providerCallId})` : ""}`);
    for (const turn of attempt.transcriptTurns) console.log(`  [${turn.offset_seconds ?? "?"}s] ${turn.speaker}: ${redactPhones(String(turn.text ?? ""))}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

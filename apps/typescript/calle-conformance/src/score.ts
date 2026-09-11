/**
 * Scores a fake CALL-E server against the corpus.
 *
 * `src/quirks.ts` has said since it was written that a predicate serves three
 * purposes, and the third one was to score a fake server against reality. The
 * first two were built. This is the third.
 *
 * Most teams building against a phone API write a mock, and they write it from
 * the documentation, because that is the only description of the API that comes
 * with the API. So the mock returns what the documentation says: a timestamp
 * with a designator, a failure code from the documented enum, a transcript that
 * stops when the agent stops. Their tests pass against it, every time, and the
 * behaviours in this corpus are the ones their tests have never seen.
 *
 * This points at a server, drives it through the SDK the same way an
 * application would, and reports which of the observed behaviours that server
 * reproduces. A score of two out of eight is not a bug in the mock. It is a
 * list of the payloads that will reach production untested.
 *
 *   node src/score.ts --base http://127.0.0.1:4010 [--calls 15] [--polls 4]
 *
 * It refuses to run against a real CALL-E origin, because scoring means
 * creating calls, and creating calls there rings telephones.
 */

import { CalleClient, type Call } from "@call-e/calle";
import { ALLOWED } from "./endpoint.ts";
import { QUIRKS, type CallPayload } from "./quirks.ts";

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const base = flag("base", "http://127.0.0.1:4010").replace(/\/+$/, "");
const calls = Number(flag("calls", "15"));
const polls = Number(flag("polls", "4"));

let origin: string;
try {
  origin = new URL(base).origin;
} catch {
  process.stderr.write(`--base is not a URL: ${base}\n`);
  process.exit(2);
}

if (ALLOWED.includes(origin as (typeof ALLOWED)[number])) {
  process.stderr.write(
    `${origin} is the real platform. Scoring it would create ${calls} calls and ring\n` +
      `${calls} telephones, and the answer is already in fixtures/: the corpus came from there.\n` +
      `Point this at a fake. Nothing was sent.\n`,
  );
  process.exit(2);
}

const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY ?? "scored-fake", baseUrl: base });

/**
 * Drives one call the way an application would: create, then poll until the
 * status stops being a waiting one. A fake that never settles is reported as
 * what it is rather than hanging the run.
 */
async function drive(): Promise<Call | null> {
  const created = await client.calls.create({
    task: "Ask whether they can hear the call clearly, thank them, and end the call.",
    recipients: [{ phone: "+12025550142", region: "US", locale: "en-US" }],
  });
  let call = created;
  for (let i = 0; i < polls; i += 1) {
    call = await client.calls.get(created.id);
    if (call.status !== "queued" && call.status !== "in_progress") return call;
  }
  return call.status === "queued" || call.status === "in_progress" ? null : call;
}

const observed = new Set<string>();
const threw = new Map<string, string>();
let settled = 0;
let unsettled = 0;

process.stdout.write(`scoring ${origin} against ${QUIRKS.length} behaviours from the corpus\n`);
process.stdout.write(`${calls} calls, up to ${polls} polls each\n\n`);

for (let n = 0; n < calls; n += 1) {
  let call: Call | null;
  try {
    call = await drive();
  } catch (error) {
    const e = error as Error & { status?: number; code?: string };
    process.stdout.write(`the server refused a create: ${e.status ?? ""} ${e.code ?? e.message}\n`);
    break;
  }
  if (call === null) {
    unsettled += 1;
    continue;
  }
  settled += 1;
  for (const quirk of QUIRKS) {
    try {
      if (quirk.holds(call as unknown as CallPayload)) observed.add(quirk.id);
    } catch (error) {
      threw.set(quirk.id, (error as Error).message);
    }
  }
}

const missing = QUIRKS.filter((q) => !observed.has(q.id));

process.stdout.write(`${settled} of ${calls} calls settled`);
process.stdout.write(unsettled === 0 ? "\n\n" : `, ${unsettled} never left a waiting status\n\n`);

for (const quirk of QUIRKS) {
  process.stdout.write(`${observed.has(quirk.id) ? "reproduced  " : "absent      "}${quirk.id}\n`);
}

process.stdout.write(`\n${observed.size} of ${QUIRKS.length} reproduced.\n`);

if (missing.length > 0) {
  process.stdout.write(`\nWhat a suite written against this server never sees:\n\n`);
  for (const quirk of missing) {
    process.stdout.write(`  ${quirk.id}\n`);
    process.stdout.write(`    ${quirk.title}\n`);
    process.stdout.write(`    ${quirk.consequence}\n\n`);
  }
}

if (threw.size > 0) {
  process.stdout.write(`predicates that threw on this server's payloads:\n`);
  for (const [id, message] of threw) process.stdout.write(`  ${id}: ${message}\n`);
}

// A gate wants an exit code. Anything short of the full set is a fail, because
// the point of the number is the behaviours that are not in it.
process.exit(settled === 0 ? 2 : missing.length === 0 ? 0 : 1);

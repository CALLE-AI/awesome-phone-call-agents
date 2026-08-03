/**
 * Headless runner, for reviewing the behaviour without opening a browser.
 *
 *   node cli.mjs --dry-run     what would happen, no calls          (default)
 *   node cli.mjs --simulate    the full loop against a fake transport, no calls
 *   node cli.mjs --execute     real calls; needs CALLE_API_KEY
 *
 * --execute additionally requires --confirm-slot <id>, so that a real call can never be one
 * mistyped flag away.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { runBackfill } from "./src/backfill.mjs";
import { FakeCalleClient, LiveCalleClient } from "./src/calle.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1] ?? null;
};

const execute = has("--execute");
const simulate = has("--simulate");
const scenarioPath = valueOf("--scenario")
  ?? fileURLToPath(new URL("./data/scenario.sample.json", import.meta.url));

const scenario = JSON.parse(await readFile(scenarioPath, "utf8"));

if (execute && valueOf("--confirm-slot") !== scenario.slot.id) {
  console.error(
    `Refusing to place real calls.\n`
    + `--execute also requires: --confirm-slot ${scenario.slot.id}`,
  );
  process.exit(2);
}

const client = execute
  ? new LiveCalleClient({ apiKey: process.env.CALLE_API_KEY, baseUrl: process.env.CALLE_BASE_URL })
  : new FakeCalleClient(scenario.scriptedAnswers);

// --dry-run and the default walk the list without calling. --simulate and --execute both run the
// full loop; only --execute reaches a real telephone.
const mode = execute || simulate ? "live" : "preview";

const ICON = {
  run_started: "*", contact_skipped: "-", contact_would_call: "~", call_started: ">",
  call_completed: "<", call_failed: "!", slot_filled: "#", contact_suppressed: ".",
  run_cancelled: "!", run_error: "!",
};

const summary = await runBackfill({
  slot: scenario.slot,
  waitlist: scenario.waitlist,
  policy: scenario.policy,
  history: scenario.history,
  client,
  request: { mode, confirmSlotId: scenario.slot.id },
  message: scenario.message,
  now: execute ? new Date() : new Date(scenario.demoNow),
  onEvent: (e) => {
    if (e.type === "run_started") {
      console.log(`\n${e.detail}\n`);
      return;
    }
    const who = e.name ? `${e.name} (${e.phone})` : "";
    console.log(`${ICON[e.type] ?? " "} ${who.padEnd(34)} ${e.answer ?? e.code ?? ""}`);
    // The provider's own call id is the only reference that ties this trail back to CALL-E,
    // so print it rather than leaving the audit record ending at our side of the boundary.
    if (e.callId) console.log(`  call ${e.callId}`);
    if (e.detail) console.log(`  ${e.detail}`);
  },
});

console.log(
  `\n${summary.filled ? `FILLED by ${summary.filledBy.name}` : "STILL OPEN"}`
  + ` | ${summary.callsPlaced} call(s) placed, ${summary.callsAvoided} avoided`
  + ` | ${summary.skipped} blocked by a guardrail, ${summary.suppressed} suppressed after the fill`,
);

process.exit(summary.filled ? 0 : 1);

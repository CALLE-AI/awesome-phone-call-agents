/**
 * One complete morning against the scripted fake. No network, no key, no call.
 *
 *   npm run demo
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LivePlacer } from "../src/calle.js";
import { loadRollCallInput } from "../src/intake.js";
import { Ledger } from "../src/ledger.js";
import { renderReport } from "../src/report.js";
import { runRollCall } from "../src/run.js";
import { FakeCalleStore, fakeFetch, loadFixture } from "../fake/calle-fake.js";

const here = dirname(fileURLToPath(import.meta.url));
const input = loadRollCallInput(resolve(here, "../examples/absences.example.json"));
const store = new FakeCalleStore(loadFixture(resolve(here, "../fixtures/outcomes.json")), {
  pollsUntilTerminal: 2,
});

const placer = new LivePlacer({
  apiKey: "fake_key_for_demo",
  baseUrl: "http://fake.local",
  fetch: fakeFetch(store),
  intervalMs: 10,
});

const report = await runRollCall(input, {
  placer,
  ledger: new Ledger(null),
  now: () => new Date("2026-09-14T13:10:00Z"), // 09:10 in New York
  log: (line) => console.error(`  · ${line}`),
});

console.log("");
console.log(renderReport(report));
console.log(`fake CALL-E received ${store.requests.length} requests; ${store.requests.filter((r) => r.method === "POST").length} call tasks created`);

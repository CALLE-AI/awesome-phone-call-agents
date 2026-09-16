/**
 * Local demo, no network and no phone calls: a fake CALL-E serves a healthy
 * line, LineCanary baselines it, then the line silently "breaks" and the next
 * run pages. Run with: npm run demo
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeCalle } from "../fake/calle-server.js";
import { formatReport } from "../src/alert.js";
import { openStore } from "../src/baseline.js";
import { createSdkPort } from "../src/calle.js";
import { runChecks } from "../src/runner.js";
import type { Config } from "../src/config.js";

const config: Config = {
  lines: [
    { id: "clinic-main", phone: "+15550100", region: "US", locale: "en-US", ownership: { method: "greeting_code", code: "LC-7391" } },
  ],
  checks: [
    {
      id: "ivr-billing-path",
      line: "clinic-main",
      task: "Listen to the IVR menu and report which option number is announced for billing. Do not press any keys.",
      resultSchema: {
        type: "object",
        properties: { billing_option: { type: "string" } },
        required: ["billing_option"],
        additionalProperties: false,
      },
      assert: [{ path: "billing_option", equals: "3" }],
      timing: { maxSecondsToAnswer: 15 },
    },
  ],
  baselineDir: join(mkdtempSync(join(tmpdir(), "linecanary-demo-")), "baselines"),
  historyLimit: 200,
};

const healthy = {
  phone: "+15550100",
  structuredResult: { billing_option: "3" },
  confidence: { score: 0.94, label: "high" },
  turns: [
    { speaker: "bot" as const, text: "This is an automated test call from LineCanary.", offsetSeconds: 0 },
    { speaker: "user" as const, text: "Thank you for calling Example Clinic. For appointments press 1 … for billing press 3.", offsetSeconds: 4 },
  ],
};

const broken = {
  phone: "+15550100",
  structuredResult: { billing_option: "5" },
  confidence: { score: 0.81, label: "medium" },
  turns: [
    { speaker: "bot" as const, text: "This is an automated test call from LineCanary.", offsetSeconds: 0 },
    { speaker: "user" as const, text: "Thank you for calling Example Clinic. For appointments press 1 … for billing press 5.", offsetSeconds: 11 },
  ],
};

const fake = await startFakeCalle([healthy]);
try {
  const store = openStore(config.baselineDir);
  store.recordVerification({ lineId: "clinic-main", phone: "+15550100", method: "greeting_code", verifiedAt: new Date().toISOString(), callId: "call_demo_verify" });
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  const options = { live: true, timeoutMs: 10_000, intervalMs: 10 };

  console.log("— Day 1: the clinic's IVR is healthy —\n");
  console.log(formatReport(await runChecks(config, port, store, options)));

  console.log("\n— Day 2: an IVR update silently moves billing from option 3 to 5 —\n");
  fake.setScenario(broken);
  const report = await runChecks(config, port, store, options);
  console.log(formatReport(report));
  console.log("\nExit code a CI job would see:", report.ok ? 0 : 1);
} finally {
  await fake.close();
}

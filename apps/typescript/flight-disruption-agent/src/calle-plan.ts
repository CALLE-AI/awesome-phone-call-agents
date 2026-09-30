// Sends the desk's real call tasks to CALL-E's planner (plan_call) and prints CALL-E's verdict.
// Uses your `calle auth login`. Planning never dials anyone.
// CALLE_PLAN_PHONE=+65XXXXXXXX npm run calle-plan
import { CliPlanner, DryRunGateway } from "./calle.ts";
import { loadEnvFile } from "./config.ts";
import { loadCatalog } from "./data.ts";
import { Desk } from "./desk.ts";

loadEnvFile();
const phone = process.env.CALLE_PLAN_PHONE?.trim() || process.env.LIVE_DEMO_PHONE?.trim();
if (!phone) {
  console.error("Set CALLE_PLAN_PHONE to your own number in a CALL-E supported region (for example +65...). Planning never dials it.");
  process.exit(2);
}
const now = () => new Date("2026-09-19T08:00:00+07:00").getTime();
const desk = new Desk(loadCatalog(), new DryRunGateway(0), {
  statePath: null,
  liveCallBudget: 0,
  now,
  planner: new CliPlanner(process.env.CALLE_CLI?.trim() || undefined),
  planPhone: phone,
});

const d = desk.reportDelay("NA721-2026-09-20", 240, "a late inbound aircraft");
const request = desk.submitRequest("L6F2KM", "change", null, "chat");
const checks = [
  { label: "Delay call to Daniel Wijaya (M3P8RD)", target: { kind: "passenger" as const, disruptionId: d.id, pnr: "M3P8RD" } },
  { label: "Request call to Nadia Kusuma (L6F2KM)", target: { kind: "intake" as const, id: request.request.id } },
];

for (const c of checks) {
  process.stdout.write(`\n${c.label}\n  asking CALL-E's planner... `);
  const plan = await desk.checkWithCalle(c.target);
  console.log(plan.ready ? "ready to run" : "needs changes");
  for (const q of plan.questions) console.log(`  CALL-E asks: ${q}`);
  if (plan.goal) console.log(`  CALL-E's plan (first lines):\n    ${plan.goal.split("\n").slice(0, 3).join("\n    ")}`);
}
console.log("\nNo call was placed.\n");

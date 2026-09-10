require("dotenv").config();
const { graph } = require("../graph");
const leads = require("../fixtures/sample-leads.json");
const {
  leadStore,
  activityLog,
  callHistoryLog,
} = require("../fixtures/demoStore");

const CALLE_DRY_RUN = process.env.CALLE_DRY_RUN !== "false"; // default true

async function main() {
  for (const lead of leads) {
    console.log(`\n=== Running call-agent for lead: ${lead.name} ===`);

    const result = await graph.invoke({
      leadId: lead._id,
      requestId: `demo-${lead._id}`,
    });

    console.log("Final state:", JSON.stringify(result, null, 2));
  }

  console.log("\n=== Lead store after run ===");
  console.log(JSON.stringify([...leadStore.values()], null, 2));

  console.log("\n=== Activity log ===");
  console.log(JSON.stringify(activityLog, null, 2));

  console.log("\n=== Call history log ===");
  console.log(JSON.stringify(callHistoryLog, null, 2));

  console.log(
    `\nDone. ${CALLE_DRY_RUN ? "Set CALLE_DRY_RUN=false in .env to place a real call instead." : ""}`,
  );
}

main().catch((err) => {
  console.error("Demo run failed:", err);
  process.exit(1);
});

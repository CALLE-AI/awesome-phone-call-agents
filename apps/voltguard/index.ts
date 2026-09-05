import express from "express";
import { CalleClient } from "@call-e/calle";

const app = express();
app.use(express.json());

// Initialize the CALL-E client with an environment variable (SAFE)
const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY || "YOUR_API_KEY_HERE"
});

app.post("/webhook/fault", async (req, res) => {
  console.log("⚡ Fault signal received! Executing L2 escalation logic...");
  
  // Send immediate 200 OK receipt back to the webhook sender
  res.status(200).send({ status: "Signal received, initiating call sequence" });

  try {
    const call = await client.calls.createAndWait({
      task: "Call +1-212-555-0100. State there is a critical voltage drop on the 7.8kW solar array. Ask the user to verbally confirm that personnel are clear and it is safe to reset the main contactor.",
      resultSchema: {
        type: "object",
        required: ["authorized", "personnel_clear"],
        properties: {
          authorized: { type: "boolean" },
          personnel_clear: { type: "boolean" }
        }
      }
    });

    console.log("📞 Call process finished.");
    console.log("Result output:", call.structuredResult);

    if (call.taskCompleted && call.structuredResult?.authorized) {
      console.log("✅ Authorization confirmed! Main contactor reset approved.");
    } else {
      console.log("❌ Authorization failed or denied.");
    }
  } catch (error) {
    console.error("❌ Failed to execute call task:", error);
  }
});

app.listen(3000, () => console.log("🛡️ VoltGuard server listening on port 3000"));

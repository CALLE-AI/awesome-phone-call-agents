import "dotenv/config";
import { CalleClient } from "@call-e/calle";

const apiKey=process.env.CALLE_API_KEY;
const phoneNumber="+12025550100";

if (!apiKey) {
  throw new Error("CALLE_API_KEY is not set");
}

if (!phoneNumber) {
  throw new Error("CALLE_PHONE_NUMBER is not set");
}

const client = new CalleClient({
  apiKey,
});

console.log("CALL-E client initialized successfully.");
console.log("Preparing call to:", phoneNumber);

const call = await client.calls.createAndWait({
  task: `Call ${phoneNumber} and confirm whether they can attend Friday lunch.`,

  resultSchema: {
    type: "object",
    required: ["can_attend"],
    properties: {
      can_attend: {
        type: "string",
        enum: ["yes", "no", "unknown"],
      },
    },
  },
});

console.log("\n--- CALL-E RESULT ---");
console.log("Status:", call.status);
console.log("Task completed:", call.taskCompleted);
console.log("Confidence:", call.completionConfidence);
console.log("Structured result:", call.structuredResult);
console.log("Evidence:", call.evidence);
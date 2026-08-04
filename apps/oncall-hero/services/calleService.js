import { CalleClient } from "@call-e/calle";
import dotenv from "dotenv";

dotenv.config();

const client = new CalleClient({
    apiKey: process.env.CALLE_API_KEY,
});

/**
 * Initiates an automated phone booking call via CALL-E.
 */
export async function makeBookingCall({ providerName, phoneNumber, customerName, desiredTime, notes, serviceName }) {
    console.log(`[CALL-E] Initiating call to ${providerName} (${phoneNumber})...`);

    const taskPrompt = `
You are OnCall Hero, an intelligent AI booking assistant calling ${providerName} on behalf of ${customerName}.

OBJECTIVE:
1. Greet the receptionist politely.
2. Request an appointment slot for "${serviceName}" around ${desiredTime}.
${notes ? `3. Special note/request: ${notes}` : ""}
4. If ${desiredTime} is unavailable, ask for the next closest available time slot.
5. If an appointment is confirmed, capture the confirmed date/time and any confirmation details.

Keep the conversation concise, natural, and professional.
  `.trim();

    try {
        const call = await client.calls.createAndWait({
            task: `Call ${phoneNumber}. Task instructions:\n${taskPrompt}`,
        });

        return {
            success: true,
            callId: call.id || `call_${Date.now()}`,
            phoneNumber,
            providerName,
            customerName,
            serviceName,
            status: call.status || "completed",
            taskCompleted: call.taskCompleted ?? true,
            summary: call.summary || "Call completed successfully.",
            rawResult: call.result || null,
            timestamp: new Date().toISOString(),
        };
    } catch (error) {
        console.error("[CALL-E] Execution Error:", error);
        throw new Error(error.message || "Failed to complete phone call via CALL-E.");
    }
}
import express from 'express';
import { CalleClient } from "@call-e/calle";

export const app = express();
app.use(express.json());

if (!process.env.CALLE_API_KEY && process.env.NODE_ENV !== 'test') {
    throw new Error("FATAL: CALLE_API_KEY environment variable is missing.");
}
const client = process.env.CALLE_API_KEY ? new CalleClient({ apiKey: process.env.CALLE_API_KEY }) : null;
const processedIncidents = new Set<string>();

app.post('/webhook/fault', async (req, res) => {
    if (req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: "Unauthorized" });

    const { incident_id, recipient_phone, personnel_clear, confirm_live_run } = req.body;
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    
    if (!recipient_phone || !e164Regex.test(recipient_phone)) return res.status(400).json({ error: "Invalid recipient_phone. Must be E.164 format." });
    if (incident_id && processedIncidents.has(incident_id)) return res.status(200).json({ status: "skipped", message: "Duplicate incident ID" });
    if (incident_id) processedIncidents.add(incident_id);
    if (!personnel_clear) return res.status(200).json({ status: "advisory_only", message: "Hardware lockout maintained. Personnel clearance not confirmed. No physical unlock authorized." });
    if (!confirm_live_run || !client) return res.status(200).json({ status: "dry_run", message: "Call skipped (confirm_live_run is false or in test mode)." });

    try {
        const call = await client.calls.createAndWait({
            task: `Call ${recipient_phone}. State there is a critical voltage drop on the 7.8kW solar array. Ask the user to verbally confirm that personnel are clear and it is safe to reset the main contactor.`,
            resultSchema: { type: "object", required: ["authorized", "personnel_clear"], properties: { authorized: { type: "boolean" }, personnel_clear: { type: "boolean" } } }
        });
        return res.status(200).json({ status: "success", result: call.structuredResult });
    } catch (error) {
        return res.status(500).json({ error: "Call task failed" });
    }
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(3000, () => console.log("🛡️ VoltGuard server listening on port 3000"));
}
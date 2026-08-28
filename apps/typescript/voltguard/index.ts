import express from 'express';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
    console.error("FATAL: WEBHOOK_SECRET is not set. Failing closed.");
    process.exit(1);
}

const app = express();
app.use(express.json());

app.post('/webhook/escalate', async (req, res) => {
    const authHeader = req.headers['x-webhook-secret'];
    if (authHeader !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: "Unauthorized: Invalid webhook signature" });
    }

    const { incident_id, recipient_phone, authorized, personnel_clear, confirm_live_run } = req.body;

    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!recipient_phone || !e164Regex.test(recipient_phone)) {
        return res.status(400).json({ 
            error: "Invalid recipient: Must use strict E.164 format including country code." 
        });
    }

    if (!authorized || !personnel_clear) {
         return res.status(403).json({
             error: "Escalation denied. Both 'authorized' and 'personnel_clear' must be verified."
         });
    }

    if (!confirm_live_run) {
        console.log(`[DRY-RUN] Escalation approved for incident ${incident_id}. SDK call skipped.`);
        return res.status(200).json({
            status: "dry_run_success",
            message: "Approval logic passed successfully. Pass confirm_live_run=true to trigger the simulated call."
        });
    }

    const idempotencyKey = `escalate-${incident_id}`;

    // Mask the phone number for privacy compliance
    const maskedPhone = recipient_phone ? recipient_phone.slice(0, 3) + '****' + recipient_phone.slice(-4) : 'unknown';

    console.log(`[SIMULATED LIVE] Call-E escalation WOULD trigger for ${maskedPhone} with key ${idempotencyKey}`);
    return res.status(200).json({ 
        status: "simulated_live_success", 
        message: "This is an honest fake. Call-E SDK execution simulated successfully." 
    });
});

if (process.env.NODE_ENV !== 'test') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`VoltGuard webhook listening on port ${PORT}`);
    });
}

export { app };
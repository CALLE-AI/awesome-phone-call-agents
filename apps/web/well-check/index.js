import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getContacts, getLogs, addLog } from './database.js';
import { createAndRunCall } from './calle-service.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/contacts', (req, res) => {
    res.json(getContacts());
});

app.get('/api/logs', (req, res) => {
    res.json(getLogs());
});

app.get('/api/trend/:contactId', (req, res) => {
    const { contactId } = req.params;
    const logs = getLogs().filter(l => l.contactId === contactId).slice(0, 5);
    
    if (logs.length === 0) {
        return res.json({ lines: ["No check-ins available."], hasHighStreak: false });
    }

    let highStreak = 0;
    for (const log of logs) {
        if (log.concern_level === 'high') highStreak++;
        else break;
    }

    let noConcernStreak = 0;
    for (const log of logs) {
        if (log.concern_level === 'none') noConcernStreak++;
        else break;
    }

    let medTaken = 0, medSkipped = 0;
    let validChecks = 0;

    logs.forEach(log => {
        if (log.checks) {
            validChecks++;
            if (log.checks.medication_taken === 'yes') medTaken++;
            else if (log.checks.medication_taken === 'no') medSkipped++;
        }
    });

    const lines = [];
    let hasHighStreak = false;

    if (highStreak >= 2) {
        lines.push(`Concern level has been HIGH for ${highStreak} check-ins in a row.`);
        hasHighStreak = true;
    } else if (highStreak === 1) {
        lines.push(`Concern level was HIGH in the latest check-in.`);
    } else if (noConcernStreak > 0) {
        lines.push(`No concerns in the last ${noConcernStreak} check-in${noConcernStreak > 1 ? 's' : ''}.`);
    }

    if (validChecks > 0) {
        lines.push(`${medTaken} of the last ${validChecks} completed check-ins: medication marked as taken. ${medSkipped} marked as skipped.`);
    }

    res.json({ lines, hasHighStreak });
});

app.post('/api/trigger-call', async (req, res) => {
    const { contactId } = req.body;
    const contact = getContacts().find(c => c.id === contactId);

    if (!contact) {
        return res.status(404).json({ error: 'Contact not found' });
    }

    try {
        const callResult = await createAndRunCall(contact.phone);
        
        let logEntry = {
            callId: callResult.id,
            contactId: contact.id,
            contactName: contact.name,
            status: callResult.status,
            confidence: callResult.completionConfidence
        };

        if (callResult.status === 'completed' && callResult.structuredResult) {
            logEntry = {
                ...logEntry,
                ...callResult.structuredResult
            };
        } else {
            // For no_answer, voicemail, failed
            logEntry.concern_level = 'high';
            const failReason = callResult.failureMessage ? ` (${callResult.failureCode}: ${callResult.failureMessage})` : '';
            logEntry.concern_reason = `Call resulted in ${callResult.status}${failReason}`;
            logEntry.wellbeing_summary = 'Unreachable.';
        }

        addLog(logEntry);
        
        // Mocking the alert system
        if (logEntry.concern_level === 'high') {
            console.error(`\n[ALERT] High concern for ${contact.name}: ${logEntry.concern_reason}\n`);
        }

        res.json({ success: true, log: logEntry });
    } catch (error) {
        console.error('Call failed:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    console.log(`Test mode: ${process.env.TEST_MODE !== 'false' ? 'ENABLED' : 'DISABLED'}`);
});

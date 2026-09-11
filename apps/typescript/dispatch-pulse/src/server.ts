import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { triggerPreDeliveryCall } from './calle-service.js';
import {
    authMiddleware,
    isValidE164,
    maskPhone,
    maskAddress,
    isAllowedOrigin,
    OFFICIAL_CALLE_API_URL,
    getExpectedApiKey,
    createSessionCookie
} from './security.js';
import { idempotencyManager } from './idempotency.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Store active SSE connections and event history for real-time dashboard updates
let clients: express.Response[] = [];
const eventHistory: Record<string, any> = {};

// System Engine Settings State
let engineSettings = {
    aiTone: 'Polite Nigerian Accent',
    language: 'en-NG',
    maxPolls: 35,
    mcpServerUrl: process.env.CALLE_BASE_URL || OFFICIAL_CALLE_API_URL,
    riderPhone: process.env.RIDER_TEST_PHONE || '+15555550101',
    autoDispatch: true,
    telemetry: true
};

// Health endpoint for liveness probes (unauthenticated)
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Authenticated session cookie endpoint (issues signed HMAC session cookie)
app.post('/api/auth/session', (req, res) => {
    const expectedKey = getExpectedApiKey();
    if (!expectedKey) {
        return res.status(500).json({ error: 'ServerConfigurationError', message: 'API_SECRET_KEY not configured.' });
    }

    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];
    const bodyKey = req.body?.apiKey;

    let providedKey = '';
    if (apiKeyHeader && typeof apiKeyHeader === 'string') {
        providedKey = apiKeyHeader.trim();
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.slice(7).trim();
    } else if (bodyKey && typeof bodyKey === 'string') {
        providedKey = bodyKey.trim();
    }

    if (!providedKey || providedKey !== expectedKey) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key.' });
    }

    const sessionToken = createSessionCookie(expectedKey);
    res.setHeader('Set-Cookie', `dp_session=${sessionToken}; Path=/api; HttpOnly; SameSite=Strict`);
    return res.json({ status: 'authenticated' });
});

// Protect all other /api endpoints with authentication middleware
app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/session') return next();
    return authMiddleware(req, res, next);
});

// History Endpoint
app.get('/api/history', (req, res) => {
    res.json(Object.values(eventHistory));
});

// Settings Endpoints
app.get('/api/settings', (req, res) => {
    res.json(engineSettings);
});

app.post('/api/settings', (req, res) => {
    const { mcpServerUrl, aiTone, maxPolls, autoDispatch, telemetry, riderPhone } = req.body;

    // Strict Origin Validation (Exact Official HTTPS API Origin Only)
    if (mcpServerUrl) {
        if (!isAllowedOrigin(mcpServerUrl)) {
            return res.status(400).json({
                error: 'DisallowedOrigin',
                message: `Untrusted API origin. CALL-E base URL must be set to '${OFFICIAL_CALLE_API_URL}'.`
            });
        }
    }

    if (riderPhone && !isValidE164(riderPhone)) {
        return res.status(400).json({
            error: 'InvalidPhone',
            message: `Rider phone number '${maskPhone(riderPhone)}' is invalid. Must be in valid E.164 format (e.g. +15555550101).`
        });
    }

    engineSettings = {
        ...engineSettings,
        ...(aiTone && { aiTone }),
        ...(mcpServerUrl && { mcpServerUrl }),
        ...(maxPolls && { maxPolls }),
        ...(autoDispatch !== undefined && { autoDispatch }),
        ...(telemetry !== undefined && { telemetry }),
        ...(riderPhone && { riderPhone })
    };

    // Mask PII before logging settings to server stdout
    console.log('Engine settings updated securely:', {
        ...engineSettings,
        riderPhone: maskPhone(engineSettings.riderPhone)
    });

    res.json({ message: 'Settings saved successfully', settings: engineSettings });
});

// Real-Time Fleet Endpoint (Calculated from actual event history with PII masking)
app.get('/api/riders', (req, res) => {
    const activeRiderPhone = engineSettings.riderPhone || process.env.RIDER_TEST_PHONE || '+15555550101';
    const ridersList = [
        { id: "RIDER-1", name: "Rider Tunde Bakare", bike: "Honda Ace 125 (LA-492-X)", phone: activeRiderPhone, status: "Active" },
        { id: "RIDER-2", name: "Rider Emmanuel Chukwu", bike: "TVS Neo 110 (LA-881-Y)", phone: activeRiderPhone, status: "Active" },
        { id: "RIDER-3", name: "Rider Segun Adebayo", bike: "Yamaha Crux 110 (LA-302-Z)", phone: activeRiderPhone, status: "Active" }
    ];

    const orders = Object.values(eventHistory);

    const riderStats = ridersList.map(r => {
        const assignedOrders = orders.filter((o: any) => o.rider?.name === r.name);
        const total = assignedOrders.length;
        const confirmed = assignedOrders.filter((o: any) => {
            const st = (o.status || '').toLowerCase();
            return st.includes('confirmed') || st.includes('briefed') || st.includes('dispatched');
        }).length;
        const rescheduled = assignedOrders.filter((o: any) => (o.status || '').toLowerCase().includes('reschedule') || (o.status || '').toLowerCase().includes('failed')).length;
        const rate = total > 0 ? Math.round((confirmed / total) * 100) : 100;

        return {
            ...r,
            phone: maskPhone(r.phone),
            totalDispatched: total,
            confirmedCount: confirmed,
            rescheduledCount: rescheduled,
            successRate: rate,
            lastOrder: assignedOrders.length > 0 ? assignedOrders[assignedOrders.length - 1] : null
        };
    });

    res.json(riderStats);
});

// Analytics Endpoint
app.get('/api/analytics', (req, res) => {
    const orders: any[] = Object.values(eventHistory);
    const total = orders.length;

    const confirmed = orders.filter(o => {
        const st = (o.status || '').toLowerCase();
        return st.includes('confirmed') || st.includes('briefed') || st.includes('dispatched');
    }).length;
    const rescheduled = orders.filter(o => (o.status || '').toLowerCase().includes('reschedule')).length;
    const failed = orders.filter(o => (o.status || '').toLowerCase().includes('failed')).length;
    const live = orders.filter(o => (o.status || '').toLowerCase().includes('live') || (o.status || '').toLowerCase().includes('dialing') || (o.status || '').toLowerCase().includes('stage')).length;

    const gateCodeCount = orders.filter(o => o.details?.toLowerCase().includes('gate')).length;
    const securityDropCount = orders.filter(o => o.details?.toLowerCase().includes('security') || o.details?.toLowerCase().includes('dropoff')).length;
    const unavailableCount = orders.filter(o => o.status?.toLowerCase().includes('unavailable')).length;

    const successRate = total > 0 ? Math.round((confirmed / total) * 100) : 100;

    res.json({
        totalCalls: total,
        confirmedCalls: confirmed,
        rescheduledCalls: rescheduled,
        failedCalls: failed,
        liveActiveCalls: live,
        confirmationRate: successRate,
        outcomes: {
            gateCode: gateCodeCount,
            securityDropoff: securityDropCount,
            rescheduled,
            unavailable: unavailableCount
        },
        recentHistory: orders.slice(-10)
    });
});

// SSE Endpoint (Protected via signed cookie session or header auth)
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);
    console.log('Client connected securely to SSE');

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
    });
});

// Broadcast an event to all connected dashboard clients
export const broadcastEvent = (data: any) => {
    if (data?.orderId) {
        eventHistory[data.orderId] = { ...(eventHistory[data.orderId] || {}), ...data };
    }
    clients.forEach(client => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
};

// Trigger Call Endpoint (Protected, Idempotent, Strict E.164 Validated)
app.post('/api/dispatch', async (req, res) => {
    const { orderId, customerPhone, address, riderPhone, liveConfirmed } = req.body;

    if (!orderId || !customerPhone || !address) {
        return res.status(400).json({ error: 'Missing required fields (orderId, customerPhone, address).' });
    }

    // 1. Strict E.164 Phone Format Validation
    if (!isValidE164(customerPhone)) {
        return res.status(400).json({
            error: 'InvalidPhone',
            message: `Customer phone '${maskPhone(customerPhone)}' is invalid. Must follow standard E.164 format (e.g. +15555550100).`
        });
    }

    const effectiveRiderPhone = riderPhone || engineSettings.riderPhone || process.env.RIDER_TEST_PHONE || '+15555550101';
    if (!isValidE164(effectiveRiderPhone)) {
        return res.status(400).json({
            error: 'InvalidPhone',
            message: `Rider phone '${maskPhone(effectiveRiderPhone)}' is invalid. Must follow standard E.164 format.`
        });
    }

    // 2. Duplicate Suppression strictly bound to orderId (ignoring any caller header override)
    const lock = idempotencyManager.acquireLock(orderId);
    if (!lock.success) {
        return res.status(409).json({
            error: 'Conflict',
            message: lock.reason || `A dispatch for order '${orderId}' is already in progress or unresolved.`
        });
    }

    // Initial Event Broadcast
    broadcastEvent({
        orderId,
        stage: "queued",
        status: "🟡 Initiating Verification",
        details: `Dispatched verification for Order #${orderId} (Address: ${maskAddress(address)})`,
        address,
        phone: maskPhone(customerPhone),
        rider: {
            name: "Assigning...",
            bike: "Assigning...",
            phone: maskPhone(effectiveRiderPhone)
        },
        timestamp: new Date().toLocaleTimeString()
    });

    // Execute 2-stage verification asynchronously in background
    triggerPreDeliveryCall({
        id: orderId,
        customerPhone,
        address,
        riderPhone: effectiveRiderPhone,
        liveConfirmed: Boolean(liveConfirmed)
    }, engineSettings).catch(err => {
        console.error(`[Background Dispatch Error] Order ${orderId}:`, err);
    });

    return res.json({
        message: 'Dispatch initiated successfully',
        orderId,
        status: 'queued'
    });
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`\n🟢 DispatchPulse Server running on http://localhost:${PORT}`);
        console.log(`🔒 Security Status: Origin enforcement ACTIVE (Exact HTTPS: ${OFFICIAL_CALLE_API_URL})`);
        console.log(`🛡 Idempotency Lock: Active (Strictly bound to order ID)`);
    });
}

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/server.js';
import { getExpectedApiKey, verifySessionCookie } from '../src/security.js';
import { Server } from 'http';

let server: Server;
let baseUrl: string;
const authKey: string = getExpectedApiKey() || 'test_internal_secret_key_fixed';

before(async () => {
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
            const address = server.address();
            if (address && typeof address === 'object') {
                baseUrl = `http://127.0.0.1:${address.port}`;
            }
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

describe('API Endpoint Authorization Boundaries', () => {
    test('unauthenticated GET /api/health succeeds (public probe)', async () => {
        const res = await fetch(`${baseUrl}/api/health`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.status, 'healthy');
    });

    test('unauthenticated GET /api/history returns 401 Unauthorized', async () => {
        const res = await fetch(`${baseUrl}/api/history`);
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
    });

    test('authenticated GET /api/history returns 200 with x-api-key header', async () => {
        const res = await fetch(`${baseUrl}/api/history`, {
            headers: { 'x-api-key': authKey }
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(Array.isArray(data), true);
    });

    test('authenticated GET /api/history returns 200 with Bearer token', async () => {
        const res = await fetch(`${baseUrl}/api/history`, {
            headers: { 'Authorization': `Bearer ${authKey}` }
        });
        assert.equal(res.status, 200);
    });

    test('POST /api/auth/session sets valid HMAC-signed session cookie', async () => {
        const res = await fetch(`${baseUrl}/api/auth/session`, {
            method: 'POST',
            headers: { 'x-api-key': authKey }
        });
        assert.equal(res.status, 200);
        const cookie = res.headers.get('set-cookie');
        assert.ok(cookie && cookie.includes('dp_session='));

        const cookieVal = cookie ? (cookie.split('dp_session=')[1]?.split(';')[0] || '') : '';
        assert.equal(verifySessionCookie(cookieVal, authKey), true);

        // Can access protected endpoint using signed cookie
        const authRes = await fetch(`${baseUrl}/api/history`, {
            headers: { 'Cookie': `dp_session=${cookieVal}` }
        });
        assert.equal(authRes.status, 200);
    });

    test('forged static cookie dp_session=authenticated is rejected with 401', async () => {
        const res = await fetch(`${baseUrl}/api/history`, {
            headers: { 'Cookie': 'dp_session=authenticated' }
        });
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
    });
});

describe('API Input Validation & SSRF Boundaries', () => {
    test('POST /api/settings rejects untrusted MCP origin with 400 Bad Request', async () => {
        const res = await fetch(`${baseUrl}/api/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': authKey
            },
            body: JSON.stringify({
                mcpServerUrl: 'http://malicious-attacker-server.com/steal-creds'
            })
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.error, 'DisallowedOrigin');
    });

    test('POST /api/settings rejects official hostname with non-default port with 400 Bad Request', async () => {
        const res = await fetch(`${baseUrl}/api/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': authKey
            },
            body: JSON.stringify({
                mcpServerUrl: 'https://api.heycall-e.com:8443'
            })
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.error, 'DisallowedOrigin');
    });

    test('POST /api/settings accepts approved exact official origin', async () => {
        const res = await fetch(`${baseUrl}/api/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': authKey
            },
            body: JSON.stringify({
                mcpServerUrl: 'https://api.heycall-e.com',
                aiTone: 'Polite Nigerian Accent'
            })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.settings.aiTone, 'Polite Nigerian Accent');
    });

    test('POST /api/dispatch rejects invalid phone number with 400 Bad Request and masks phone in error message', async () => {
        const res = await fetch(`${baseUrl}/api/dispatch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': authKey
            },
            body: JSON.stringify({
                orderId: 'ORD-TEST-BAD-PHONE',
                customerPhone: '15555550199', // Non-E.164 (missing leading +)
                address: 'Lekki Phase 1, Lagos'
            })
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.error, 'InvalidPhone');
        assert.ok(data.message.includes('1555****0199'));
        assert.equal(data.message.includes('15555550199'), false, 'Unmasked invalid phone must not appear in response');
    });

    test('POST /api/dispatch rejects duplicate in-flight dispatch with 409 Conflict even with different Idempotency-Key headers', async () => {
        // First request with dry-run/valid phone
        process.env.DRY_RUN = 'true';
        const orderId = 'ORD-CONCURRENT-LOCK-TEST';

        const res1 = await fetch(`${baseUrl}/api/dispatch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': authKey!,
                'Idempotency-Key': 'header-key-attempt-1'
            },
            body: JSON.stringify({
                orderId,
                customerPhone: '+15555550100',
                address: 'Admiralty Way, Lekki'
            })
        });

        assert.equal(res1.status, 200);

        // Second request on same orderId with a DIFFERENT caller header must still be rejected (bound to order)
        const res2 = await fetch(`${baseUrl}/api/dispatch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': authKey!,
                'Idempotency-Key': 'header-key-attempt-2-bypass-attempt'
            },
            body: JSON.stringify({
                orderId,
                customerPhone: '+15555550100',
                address: 'Admiralty Way, Lekki'
            })
        });

        assert.equal(res2.status, 409);
        const data2 = await res2.json();
        assert.equal(data2.error, 'Conflict');
    });
});

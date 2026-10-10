import http from 'http';

process.env.WEBHOOK_SECRET = 'test-secret-123';
process.env.NODE_ENV = 'test';

async function runTests() {
    const { app } = await import('./index.ts');
    const server = http.createServer(app);

    server.listen(0, async () => {
        const port = (server.address() as any).port;
        const baseUrl = `http://localhost:${port}/webhook/fault`;
        let passed = true;

        try {
            console.log("Running credential-free validation tests...\n");

            const r1 = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            if (r1.status !== 401) throw new Error(`Test 1 Failed: Expected 401, got ${r1.status}`);
            console.log("✅ Passed Test 1: Rejected missing secret");

            const r2 = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'test-secret-123' }, body: JSON.stringify({ recipient_phone: '123' }) });
            if (r2.status !== 400) throw new Error(`Test 2 Failed: Expected 400, got ${r2.status}`);
            console.log("✅ Passed Test 2: Enforced payload validation");

            const r3 = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'test-secret-123' }, body: JSON.stringify({ incident_id: "inc_001", recipient_phone: "+12345678901", authorized: true, personnel_clear: true, confirm_live_run: false }) });
            if (r3.status !== 200) throw new Error(`Test 3 Failed: Expected 200, got ${r3.status}`);
            console.log("✅ Passed Test 3: Standard workflow success");

        } catch (err) {
            console.error("❌ Test Suite Failed:", err);
            passed = false;
        } finally {
            server.close();
            process.exit(passed ? 0 : 1);
        }
    });
}
runTests();
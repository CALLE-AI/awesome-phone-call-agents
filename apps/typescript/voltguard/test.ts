import http from 'http';

process.env.WEBHOOK_SECRET = 'test-secret-123';
process.env.NODE_ENV = 'test';

async function runTests() {
    const { app } = await import('./index.ts');
    const server = http.createServer(app);

    server.listen(0, async () => {
        const port = (server.address() as any).port;
        const baseUrl = `http://localhost:${port}/webhook/escalate`;
        let passed = true;

        try {
            console.log("Running credential-free validation tests...\n");

            const r1 = await fetch(baseUrl, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({}) 
            });
            if (r1.status !== 401) throw new Error(`Test 1 Failed: Expected 401, got ${r1.status}`);
            console.log("✅ Passed Test 1: Successfully rejected missing secret");

            const r2 = await fetch(baseUrl, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'test-secret-123' }, 
                body: JSON.stringify({ recipient_phone: '123' }) 
            });
            if (r2.status !== 400) throw new Error(`Test 2 Failed: Expected 400, got ${r2.status}`);
            console.log("✅ Passed Test 2: Successfully enforced E.164 constraints");

            console.log("\nSuccess: Runnable app validation complete.");
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
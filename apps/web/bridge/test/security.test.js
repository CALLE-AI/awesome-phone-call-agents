const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.BRIDGE_MODE = 'simulation';
process.env.OPERATOR_SECRET = 'test-operator-secret-999';
delete process.env.AUTHORIZED_E164_RECIPIENTS;
delete process.env.AUTHORIZED_RECIPIENTS;

const { planCall, runCall, getCallStatus } = require('../src/calle');
const { app, deepMask, maskPhoneInText, maskPhone } = require('../src/server');

test('security compliance test suite', async (t) => {
  let server;
  let baseUrl;

  t.before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  async function request(urlPath, options = {}) {
    const url = `${baseUrl}${urlPath}`;
    const headers = options.headers || {};
    let body = options.body;
    if (body && typeof body === 'object') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data };
  }

  await t.test('simulation mode strictly enforces simulation flags and phone masking', async () => {
    process.env.BRIDGE_MODE = 'simulation';
    const plan = await planCall({ phone: '+919876543210', goal: 'Test exception' });
    const parsed = JSON.parse(plan.stdout);
    assert.equal(parsed.mode, 'simulation');
    assert.equal(parsed.simulated, true);
    assert.equal(parsed.isLive, false);
    assert.ok(parsed.to_phone.includes('******'));
  });

  await t.test('runCall in simulation mode returns simulated payload without invoking CLI', async () => {
    process.env.BRIDGE_MODE = 'simulation';
    const run = await runCall({ planId: 'plan-xyz', confirmToken: 'token-xyz' });
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.mode, 'simulation');
    assert.equal(parsed.simulated, true);
    assert.equal(parsed.isLive, false);
    assert.equal(parsed.status, 'in_progress');
  });

  await t.test('getCallStatus in simulation mode returns completed simulation status', async () => {
    process.env.BRIDGE_MODE = 'simulation';
    const status = await getCallStatus({ runId: 'run-xyz' });
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.mode, 'simulation');
    assert.equal(parsed.simulated, true);
    assert.equal(parsed.isLive, false);
    assert.equal(parsed.status, 'completed');
  });

  await t.test('deepMask masks phone numbers in nested provider results, transcripts, and failure copies', () => {
    const complexNested = {
      providerResult: {
        to_phone: '+919876543210',
        caller_id: '+918765432109',
        nestedCalls: [
          { driver_phone: '+919123456789', status: 'initiated' }
        ],
        transcript: [
          { speaker: 'Agent', text: 'Calling +91 98765 43210 regarding your delivery on route.' },
          { speaker: 'Driver', text: 'Understood, my alternative number is 9876543211.' }
        ]
      },
      failureCopy: {
        error: { message: 'Provider timeout calling recipient +91-98765-43210' },
        stderr: 'dial tcp +919876543210:443: i/o timeout',
        note: 'Could not connect to +919876543210'
      }
    };

    const masked = deepMask(complexNested);

    // Verify top-level and nested provider phones
    assert.ok(masked.providerResult.to_phone.includes('******'));
    assert.ok(!masked.providerResult.to_phone.includes('9876543210'));
    assert.ok(masked.providerResult.caller_id.includes('******'));
    assert.ok(!masked.providerResult.caller_id.includes('8765432109'));
    assert.ok(masked.providerResult.nestedCalls[0].driver_phone.includes('******'));

    // Verify transcripts and dialogue turns
    assert.ok(!masked.providerResult.transcript[0].text.includes('98765 43210'));
    assert.ok(masked.providerResult.transcript[0].text.includes('******'));
    assert.ok(!masked.providerResult.transcript[1].text.includes('9876543211'));
    assert.ok(masked.providerResult.transcript[1].text.includes('******'));

    // Verify failure copies and stderr
    assert.ok(!masked.failureCopy.error.message.includes('98765-43210'));
    assert.ok(masked.failureCopy.error.message.includes('******'));
    assert.ok(!masked.failureCopy.stderr.includes('9876543210'));
    assert.ok(masked.failureCopy.stderr.includes('******'));
    assert.ok(!masked.failureCopy.note.includes('9876543210'));
  });

  await t.test('protects private task, call, and org reads against unauthenticated access', async () => {
    // Unauthenticated GET /api/tasks
    const resTasks = await request('/api/tasks');
    assert.equal(resTasks.status, 401);
    assert.equal(resTasks.data.error.code, 'UNAUTHORIZED');

    // Unauthenticated GET /api/tasks/:id
    const resTask = await request('/api/tasks/TASK-1');
    assert.equal(resTask.status, 401);

    // Unauthenticated GET /api/tasks/:id/call-status
    const resStatus = await request('/api/tasks/TASK-1/call-status');
    assert.equal(resStatus.status, 401);

    // Unauthenticated GET /api/calls
    const resCalls = await request('/api/calls');
    assert.equal(resCalls.status, 401);

    // Unauthenticated GET /api/organization
    const resOrg = await request('/api/organization');
    assert.equal(resOrg.status, 401);

    // Unauthenticated GET /api/workflows
    const resWf = await request('/api/workflows');
    assert.equal(resWf.status, 401);

    // Hardcoded publicly embedded demo session token is REJECTED
    const resBogus = await request('/api/tasks', {
      headers: { Authorization: 'Bearer bridge-demo-session-token' }
    });
    assert.equal(resBogus.status, 401);
  });

  await t.test('allows authenticated access via dynamic login session', async () => {
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'demo@bridge.com', password: 'Bridge123!' }
    });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.data.token);
    const userToken = loginRes.data.token;

    // Authenticated user can read tasks
    const tasksRes = await request('/api/tasks', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(tasksRes.status, 200);
    assert.ok(Array.isArray(tasksRes.data));

    // Authenticated user can read organization
    const orgRes = await request('/api/organization', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(orgRes.status, 200);
    assert.ok(orgRes.data.people);

    // Authenticated user can read workflows
    const wfRes = await request('/api/workflows', {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(wfRes.status, 200);
  });

  await t.test('rejects live mode switch without operator secret authority', async () => {
    // Login as normal demo user
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'demo@bridge.com', password: 'Bridge123!' }
    });
    const userToken = loginRes.data.token;

    // Normal user attempts to change mode to live
    const modeChangeRes = await request('/api/settings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { mode: 'live' }
    });
    assert.equal(modeChangeRes.status, 403);
    assert.equal(modeChangeRes.data.error.code, 'OPERATOR_SECRET_REQUIRED');
  });

  await t.test('operator secret serves as valid authority for live mode changes', async () => {
    // Mode change with operator secret via x-operator-secret header
    const opRes = await request('/api/settings', {
      method: 'POST',
      headers: { 'x-operator-secret': 'test-operator-secret-999' },
      body: { mode: 'live' }
    });
    // Since bounded acceptance list is currently empty, it responds with simulation-only policy 403
    // but NOT OPERATOR_SECRET_REQUIRED!
    assert.equal(opRes.status, 403);
    assert.equal(opRes.data.error.code, 'SIMULATION_ONLY_POLICY');
  });

  await t.test('public/index.html does not contain inline onclick handlers with interpolated IDs', () => {
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    // Verify no inline onclick with interpolations
    const inlineHandlerMatches = indexHtml.match(/onclick="[^"]*\$\{/g);
    assert.equal(inlineHandlerMatches, null, 'No inline event handlers should interpolate IDs');

    // Verify presence of safe data-* attributes
    assert.ok(indexHtml.includes('data-workflow-id='));
    assert.ok(indexHtml.includes('data-task-id='));
    assert.ok(indexHtml.includes('data-person-id='));

    // Verify hardcoded session token is removed
    assert.ok(!indexHtml.includes("'bridge-demo-session-token'"));
  });
});

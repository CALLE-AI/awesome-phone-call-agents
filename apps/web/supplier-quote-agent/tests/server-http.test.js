// Drives the actual Express app (src/server.js) over a real loopback socket — the HTTP
// layer is where local-only enforcement and the actor-required check actually live, and
// no other test in this suite exercises it; everything else calls invoke() in-process.
const http = require('http');
const { app } = require('../src/server');

let server;
let baseUrl;

beforeAll((done) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

function postInvoke(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${baseUrl}/api/invoke`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    }).on('error', reject);
  });
}

describe('POST /api/invoke over a real socket', () => {
  test('refuses with 400 when actor is missing — no silent owner default', async () => {
    const created = await postInvoke({ tool: 'create_task', args: { name: 'HTTP no actor', sku: 'HTTP-1', quantity: 1 }, actor: 'owner' });
    const id = created.body.result.id;
    await postInvoke({ tool: 'plan_call', args: { id, goal: 'Get a quote' }, actor: 'agent' });

    const approveNoActor = await postInvoke({ tool: 'approve_task', args: { id } });

    expect(approveNoActor.status).toBe(400);
    expect(approveNoActor.body.error).toMatch(/actor required/i);

    const state = await getJson('/api/state');
    const task = state.body.tasks.find((t) => t.id === id);
    expect(task.status).toBe('planned');
  });

  test('refuses with 400 when tool is missing', async () => {
    const result = await postInvoke({ args: {}, actor: 'owner' });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/tool required/i);
  });

  test('a full plan -> approve -> place_call round trip succeeds with actor explicitly supplied, and phone stays masked', async () => {
    const created = await postInvoke({
      tool: 'create_task',
      args: { name: 'HTTP round trip', sku: 'HTTP-2', quantity: 1, suppliers: [{ name: 'Acme Corp', phone: '+15550100' }] },
      actor: 'owner'
    });
    const id = created.body.result.id;

    await postInvoke({ tool: 'plan_call', args: { id, goal: 'Get a quote' }, actor: 'agent' });
    const approved = await postInvoke({ tool: 'approve_task', args: { id }, actor: 'owner' });
    expect(approved.body.result.status).toBe('approved');

    const placed = await postInvoke({ tool: 'place_call', args: { id }, actor: 'agent' });
    expect(placed.status).toBe(200);
    expect(placed.body.result.status).toBe('completed');
    expect(placed.body.result.suppliers[0].phone).toMatch(/^\+•+00$/);
  });

  test('actor omitted on a create_task request is refused, not silently attributed to owner', async () => {
    const result = await postInvoke({ tool: 'create_task', args: { name: 'No actor', sku: 'HTTP-3', quantity: 1 } });
    expect(result.status).toBe(400);
  });
});

// A number leaks if its digits survive in any spelling, so the check is a digit run that
// tolerates separators — never one exact string.
function digitRunPattern(digits) {
  return new RegExp(digits.split('').join('[^0-9]{0,4}'));
}

describe('phone numbers never cross the socket in error copies (#524 item 2)', () => {
  test('an error echoing a caller-supplied number is masked in the response and the activity log', async () => {
    const result = await postInvoke({ tool: 'get_task', args: { id: '+44 20 7946 0958' }, actor: 'owner' });
    expect(result.body.success).toBe(false);
    expect(result.body.error).toMatch(/not found/);
    expect(JSON.stringify(result.body)).not.toMatch(digitRunPattern('2079460958'));

    const log = await getJson('/api/activity-log');
    expect(JSON.stringify(log.body)).not.toMatch(digitRunPattern('2079460958'));
  });

  // With the real provider selected and a key present, a sample destination is refused
  // before any request — global fetch is stubbed to prove it is never reached.
  test('the real provider refuses a sample destination, and the response carries no digits of it', async () => {
    const saved = { provider: process.env.CALL_PROVIDER, key: process.env.CALLE_API_KEY };
    const realFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.reject(new Error('network must never be reached')));
    process.env.CALL_PROVIDER = 'calle';
    process.env.CALLE_API_KEY = 'test-key-not-real';
    try {
      const created = await postInvoke({
        tool: 'create_task',
        args: { name: 'Sample number', sku: 'HTTP-4', quantity: 1, suppliers: [{ name: 'Acme', phone: '+1 (202) 555-0147' }] },
        actor: 'owner'
      });
      const id = created.body.result.id;
      await postInvoke({ tool: 'plan_call', args: { id, goal: 'Get a quote' }, actor: 'agent' });
      await postInvoke({ tool: 'approve_task', args: { id }, actor: 'owner' });

      const placed = await postInvoke({ tool: 'place_call', args: { id }, actor: 'agent' });

      expect(placed.body.success).toBe(false);
      expect(placed.body.error).toMatch(/reserved for fiction/);
      expect(JSON.stringify(placed.body)).not.toMatch(digitRunPattern('2025550147'));
      expect(global.fetch).not.toHaveBeenCalled();
      const state = await getJson('/api/state');
      expect(state.body.tasks.find((t) => t.id === id).status).toBe('failed');
    } finally {
      global.fetch = realFetch;
      for (const [name, value] of [['CALL_PROVIDER', saved.provider], ['CALLE_API_KEY', saved.key]]) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});

describe('GET routes over a real socket', () => {
  test('/api/state masks phone numbers in the seeded task', async () => {
    const result = await getJson('/api/state');
    expect(result.status).toBe(200);
    const task1 = result.body.tasks.find((t) => t.id === 'task_1');
    expect(task1.suppliers[0].phone).not.toContain('555');
    expect(task1.suppliers[0].phone).toMatch(/^\+•+\d{2}$/);
  });
});

describe('a nationally written number echoed back as an id (#524 item 2, second pass)', () => {
  test('get_task with a phone number as its id: masked in the error and in the activity log', async () => {
    const result = await postInvoke({ tool: 'get_task', args: { id: '0161 496 0123' }, actor: 'owner' });
    expect(result.body.error).toBe('Task •••••23 not found');
    expect(JSON.stringify(result.body)).not.toMatch(digitRunPattern('01614960123'));
    const log = await getJson('/api/activity-log');
    expect(JSON.stringify(log.body)).not.toMatch(digitRunPattern('01614960123'));
  });
});

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

describe('GET routes over a real socket', () => {
  test('/api/state masks phone numbers in the seeded task', async () => {
    const result = await getJson('/api/state');
    expect(result.status).toBe(200);
    const task1 = result.body.tasks.find((t) => t.id === 'task_1');
    expect(task1.suppliers[0].phone).not.toContain('555');
    expect(task1.suppliers[0].phone).toMatch(/^\+•+\d{2}$/);
  });
});

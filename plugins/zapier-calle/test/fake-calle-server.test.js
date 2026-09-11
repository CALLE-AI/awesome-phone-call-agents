import { describe, it, expect, afterEach } from 'vitest';
import { startFakeCalle } from './fake-calle-server.js';

let server;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

describe('fake CALL-E server', () => {
  it('accepts a call and echoes the idempotency key', async () => {
    server = await startFakeCalle({});
    const response = await fetch(`${server.url}/v1/calls`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-key',
        'idempotency-key': 'abc123',
      },
      body: JSON.stringify({ task: 'Call +15550123456 and confirm.' }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.object).toBe('call_task');
    expect(body.status).toBe('queued');
    expect(body.id).toMatch(/^call_/);
    expect(server.lastRequest().headers['idempotency-key']).toBe('abc123');
  });

  it('returns 400 instead of crashing on a malformed request body', async () => {
    server = await startFakeCalle({});
    const response = await fetch(`${server.url}/v1/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
      body: '{not json',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid_json');
  });

  it('rejects a request without a bearer token', async () => {
    server = await startFakeCalle({});
    const response = await fetch(`${server.url}/v1/goals?limit=1`);
    expect(response.status).toBe(401);
  });

  it('returns the created call from GET /v1/calls/{id}', async () => {
    server = await startFakeCalle({});
    const created = await fetch(`${server.url}/v1/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
      body: JSON.stringify({ task: 'Call +15550123456.' }),
    }).then((r) => r.json());

    const fetched = await fetch(`${server.url}/v1/calls/${created.id}`, {
      headers: { authorization: 'Bearer k' },
    }).then((r) => r.json());

    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe('queued');
  });

  it('delivers a webhook event to a callback url', async () => {
    server = await startFakeCalle({});
    const received = [];
    const { createServer } = await import('node:http');
    const sink = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        received.push(JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
    const sinkUrl = `http://127.0.0.1:${sink.address().port}/hook`;

    const status = await server.sendWebhook(sinkUrl, { id: 'evt_1', type: 'call.completed' });

    expect(status).toBe(200);
    expect(received[0].id).toBe('evt_1');
    await new Promise((resolve) => sink.close(resolve));
  });
});

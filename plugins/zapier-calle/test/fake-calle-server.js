import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
  });

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};

export async function startFakeCalle({ port = 0 } = {}) {
  const calls = new Map();
  let lastRequest = null;

  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url, 'http://127.0.0.1');
    lastRequest = {
      method: req.method,
      path: url.pathname,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    };

    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      return send(res, 401, { error: { code: 'unauthorized', message: 'Missing bearer token.' } });
    }

    if (req.method === 'GET' && url.pathname === '/v1/goals') {
      return send(res, 200, { data: [], next_cursor: null });
    }

    if (req.method === 'POST' && url.pathname === '/v1/calls') {
      const id = `call_${randomUUID().slice(0, 8)}`;
      const record = {
        id,
        object: 'call_task',
        status: 'queued',
        task: lastRequest.body.task,
        recipients: [],
        structured_result: null,
        summary: null,
        task_completed: false,
        completion_confidence: { score: 0, label: 'low' },
        evidence: [],
        metadata: lastRequest.body.metadata || {},
        failure_code: null,
        failure_message: null,
        created_at: '2026-08-02T00:00:00Z',
        completed_at: null,
      };
      calls.set(id, record);
      return send(res, 201, record);
    }

    const callMatch = url.pathname.match(/^\/v1\/calls\/([^/]+)$/);
    if (req.method === 'GET' && callMatch) {
      const record = calls.get(callMatch[1]);
      if (!record) return send(res, 404, { error: { code: 'not_found', message: 'No such call.' } });
      return send(res, 200, record);
    }

    return send(res, 404, { error: { code: 'not_found', message: 'Unknown route.' } });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    lastRequest: () => lastRequest,
    setStatus: (id, patch) => { calls.set(id, { ...calls.get(id), ...patch }); },
    sendWebhook: async (callbackUrl, event) => {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      return response.status;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

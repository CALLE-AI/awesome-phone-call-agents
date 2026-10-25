import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

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
  const keys = new Map();
  let lastRequest = null;

  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url, 'http://127.0.0.1');
    let body = null;
    let malformed = false;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        malformed = true;
      }
    }
    lastRequest = { method: req.method, path: url.pathname, headers: req.headers, body };

    if (malformed) {
      return send(res, 400, { error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    }

    if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
      return send(res, 401, { error: { code: 'unauthorized', message: 'Missing bearer token.' } });
    }

    if (req.method === 'GET' && url.pathname === '/v1/goals') {
      return send(res, 200, { data: [], next_cursor: null });
    }

    if (req.method === 'POST' && url.pathname === '/v2/calls') {
      const key = req.headers['idempotency-key'];
      if (!key || !/^\+[1-9][0-9]{7,14}$/.test(body?.phone || '') || !body?.result_schema || 'recipients' in body) {
        return send(res, 400, { error: { code: 'invalid_request', message: 'One phone, result_schema and Idempotency-Key are required.' } });
      }
      if (keys.has(key)) {
        const original = keys.get(key);
        if (!isDeepStrictEqual(original.body, body)) {
          return send(res, 409, { error: { code: 'idempotency_conflict', message: 'Preserve the original request, including webhook_url.' } });
        }
        return send(res, 202, calls.get(original.id));
      }
      const id = `call_${randomUUID().slice(0, 8)}`;
      const record = {
        id, object: 'call', call_id: null, status: 'queued', call_outcome: null,
        result_status: 'pending', result: null, error: null, transcript: [],
        task: body.task, phone: body.phone, region: body.region || 'US', locale: body.locale || 'en-US',
        metadata: body.metadata || {}, created_at: '2026-08-02T00:00:00Z', completed_at: null,
      };
      calls.set(id, record);
      keys.set(key, { body, id });
      return send(res, 202, record);
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

    const callMatch = url.pathname.match(/^\/(v1|v2)\/calls\/([^/]+)$/);
    if (req.method === 'GET' && callMatch) {
      const record = calls.get(callMatch[2]);
      if (!record || record.object !== (callMatch[1] === 'v2' ? 'call' : 'call_task')) return send(res, 404, { error: { code: 'not_found', message: 'No such call.' } });
      return send(res, 200, record);
    }

    return send(res, 404, { error: { code: 'not_found', message: 'Unknown route.' } });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    lastRequest: () => lastRequest,
    callCount: () => calls.size,
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

import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CalleClient, CalleError, buildCallRequest, maskForDisplay, publicError } from './calle.mjs';

const DEFAULT_WEB = fileURLToPath(new URL('../web/', import.meta.url));
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new CalleError('invalid_request', 'Send a JSON request body.', { status: 415 });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new CalleError('invalid_request', 'The request body exceeds 16 KB.', { status: 413 });
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CalleError('invalid_request', 'The request body is not valid JSON.', { status: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CalleError('invalid_request', 'Provide a JSON object.', { status: 400 });
  return data;
}

export function createAppServer({ webDir = DEFAULT_WEB, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const root = resolve(webDir);
  const client = new CalleClient({ apiKey: env.CALLE_API_KEY, fetchImpl });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const path = decodeURIComponent(url.pathname);
      if (path === '/api/health' && request.method === 'GET') {
        return sendJson(response, 200, { ok: true, service: 'harvest-relay', mode: 'rehearsal', configured: client.configured, live_calls_exposed: false });
      }
      if (path === '/api/preview' && ['GET', 'POST'].includes(request.method)) {
        const input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(request);
        const scenario = JSON.parse(await readFile(resolve(root, 'scenario.json'), 'utf8'));
        const payload = buildCallRequest(scenario, { providerType: input.provider_type, providerId: input.provider_id, phone: input.phone, region: input.region, locale: input.locale });
        return sendJson(response, 200, { mode: 'preview', dialed: false, request: maskForDisplay(payload) });
      }
      if (path === '/api/check' && ['GET', 'POST'].includes(request.method)) {
        const result = await client.check();
        return sendJson(response, 200, { mode: 'read-only', dialed: false, ...result });
      }
      // There is deliberately no HTTP call-creation route, including on localhost.
      if (path.startsWith('/api/')) return sendJson(response, 404, { ok: false, error: { code: 'not_found', message: 'No such API endpoint.' } });
      if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Static files support GET and HEAD.' } });
      if (path.includes('\0') || path.includes('\\') || path.split('/').some(segment => segment.startsWith('.'))) return sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'This path is not public.' } });
      const requested = resolve(root, path === '/' ? 'index.html' : `.${path}`);
      if (!requested.startsWith(`${root}${sep}`)) return sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'This path is not public.' } });
      let actual;
      try {
        actual = await realpath(requested);
        const realRoot = await realpath(root);
        if (!actual.startsWith(`${realRoot}${sep}`)) return sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'This path is not public.' } });
        if (!(await stat(actual)).isFile()) throw new Error('Not a file');
      } catch {
        return sendJson(response, 404, { ok: false, error: { code: 'not_found', message: 'File not found.' } });
      }
      const type = CONTENT_TYPES[extname(actual).toLowerCase()];
      if (!type) return sendJson(response, 404, { ok: false, error: { code: 'not_found', message: 'File type is not public.' } });
      const data = await readFile(actual);
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error instanceof CalleError ? error.status ?? (error.code === 'not_configured' ? 503 : 400) : error instanceof URIError ? 400 : 500;
      sendJson(response, status, { ok: false, dialed: false, error: publicError(error) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8766);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => console.log(`Harvest Relay: http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(`Local server failed: ${error.code ?? 'unknown_error'}`); process.exitCode = 1; });
}

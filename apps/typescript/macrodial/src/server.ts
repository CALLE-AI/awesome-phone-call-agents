import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DemoStore, type Outcome } from './store.ts';
import { preview } from './scenario.ts';

export function createApp(stateFile = fileURLToPath(new URL('../.local/demo-state.json', import.meta.url))) {
  const store = new DemoStore(stateFile);
  const server = createServer(async (req, res) => {
    const address = server.address();
    const host = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.host !== host) { json(403, { error: 'Loopback host required.' }); return; }
    try {
      if (req.method === 'GET' && req.url === '/api/preview') { json(200, preview()); return; }
      if (req.method === 'GET' && req.url === '/api/state') { json(200, await store.read()); return; }
      if (req.method === 'POST' && req.url?.startsWith('/api/simulate/')) {
        if (req.headers.origin !== `http://${host}`) { json(403, { error: 'Same-origin request required.' }); return; }
        const outcome = req.url.slice('/api/simulate/'.length);
        if (!['INTERESTED', 'NO_ANSWER'].includes(outcome)) { json(422, { error: 'Unsupported synthetic outcome.' }); return; }
        json(200, await store.apply(outcome as Outcome)); return;
      }
      const files: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']
      };
      if (req.method === 'GET' && files[req.url ?? '']) {
        const [file, type] = files[req.url!];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        res.end(await readFile(new URL(`../public/${file}`, import.meta.url))); return;
      }
      json(404, { error: 'Not found. This app has no calling, import, generation, or engine-enable endpoint.' });
    } catch { json(409, { error: 'Result conflict or unreadable local state. Inspect the demo state file; no call was made.' }); }
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp();
  server.listen(4188, '127.0.0.1', () => console.log('MacroDial NO-CALL reference: http://127.0.0.1:4188'));
}

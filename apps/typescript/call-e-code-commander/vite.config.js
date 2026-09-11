import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { readRotaFromEnv } from './src/config/rota.js';
import { guardProxyRequest, RateLimiter, readAllowedNumbers } from './api/_lib/proxyGuard.js';
import { getIncidentStore } from './api/_lib/incidentStore.js';
import { handleWebhookDelivery } from './api/_lib/webhookReceiver.js';

const CALLE_API = 'https://api.heycall-e.com';

/**
 * Where the dev server remembers terminal call outcomes.
 *
 * File-backed by default here, which is what makes "close the tab and come
 * back" work on a laptop. Overridable, and gitignored, because it holds
 * transcripts of real calls to real people.
 */
const DEFAULT_STORE_PATH = '.calle/incidents.json';

/**
 * Reads the CALL-E key from the server environment.
 *
 * Checks a .env file as well as the process environment, because the inline
 * `VAR=value command` form does not work in PowerShell, which is where this is
 * most likely to be run. The value is only ever read here, on the server, and
 * is never sent to the page.
 */
function readServerKey(mode) {
  if (process.env.CALLE_API_KEY) return process.env.CALLE_API_KEY.trim();
  const fileEnv = loadEnv(mode || 'development', process.cwd(), 'CALLE');
  return (fileEnv.CALLE_API_KEY || '').trim();
}

/**
 * Reads the seeded on-call rota from the server environment.
 *
 * Values set in the process environment win over the .env file, matching how
 * the API key is resolved. The parsing itself lives in src/config/rota.js so it
 * can be tested without starting a server.
 */
function readServerRota(mode) {
  const fileEnv = loadEnv(mode || 'development', process.cwd(), 'CALLE');
  return readRotaFromEnv({ ...fileEnv, ...process.env });
}

/**
 * Server-side CALL-E proxy.
 *
 * CALL-E's own guidance is explicit: the SDK is a server SDK, keys must not be
 * sent to browser code, and a frontend that needs to start a call should go
 * through its own backend. This middleware is that backend.
 *
 * When CALLE_API_KEY is present in the environment, the page talks to
 * /api/calle/v1/* and never sees a key. The middleware attaches the real
 * Authorization header on the way out. Requests from the page carry no
 * credential at all, so there is nothing in the browser worth stealing.
 *
 * With no CALLE_API_KEY set, the proxy reports itself unavailable and the app
 * runs a clearly labelled simulation. There is no browser-side key path at all,
 * so an unconfigured checkout can still be explored without a credential ever
 * being typed into the page.
 */
function callEProxy() {
  let apiKey = '';
  let rota = [];
  let serverEnv = {};
  const limiter = new RateLimiter();

  const attach = (server) => {
    server.middlewares.use('/api/calle/mode', (req, res) => {
      const webhookUrl = (serverEnv.CALLE_WEBHOOK_URL || '').trim();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        serverKey: Boolean(apiKey),
        baseUrl: apiKey ? '/api/calle' : null,
        // Seeded rota, so a demo does not open onto three empty rows. Never a
        // credential, and always overridable in the dialog before dialling.
        rota,
        // A dev server has no public address, so unless a tunnel URL is
        // configured there is nowhere for CALL-E to deliver to and the ladder
        // keeps polling instead.
        webhookUrl: /^https:\/\//i.test(webhookUrl) ? webhookUrl : null,
        dialling: {
          restricted: false,
          allowedCount: readAllowedNumbers(serverEnv).length
        },
        incidentStore: {
          persistent: getIncidentStore(serverEnv).isPersistent
        }
      }));
    });

    // Terminal call state from CALL-E, so an escalation survives the tab that
    // started it. Reachable in dev only through a tunnel, which is why the URL
    // is configuration rather than an assumption about the address.
    server.middlewares.use('/api/calle/webhook', async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: 'Webhook deliveries are POSTed.' }));
        return;
      }

      const rawBody = await readBody(req);
      const token = new URL(req.url, 'http://receiver.local').searchParams.get('token');
      const result = await handleWebhookDelivery({
        rawBody,
        token,
        env: serverEnv,
        store: getIncidentStore(serverEnv)
      });

      res.statusCode = result.status;
      res.end(JSON.stringify(result.body));
    });

    server.middlewares.use('/api/calle/incident', (req, res) => {
      const id = req.url.split('?')[0].replace(/^\//, '');
      const store = getIncidentStore(serverEnv);
      const incident = store.get(id);
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({
        incidentId: id,
        found: Boolean(incident),
        durability: store.describeDurability(),
        persistent: store.isPersistent,
        calls: incident?.calls || []
      }));
    });

    server.middlewares.use('/api/calle/v1', async (req, res) => {
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: { code: 'proxy_not_configured', message: 'No CALLE_API_KEY on the server. Put it in a .env file or the environment and restart.', details: {} }
        }));
        return;
      }

      // req.url is already stripped of the mount path by connect.
      const target = `${CALLE_API}/v1${req.url}`;

      let body;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await readBody(req);
      }

      // The same guard the deployed function runs, minus the recipient
      // allowlist. This server listens on the operator's own machine with the
      // operator's own key, so restricting which of their own numbers they may
      // dial would block the exact workflow the restriction exists to protect.
      // The route allowlist and the rate limit still apply, because a bug that
      // dials in a loop costs the same money here as anywhere else.
      const verdict = guardProxyRequest({
        method: req.method,
        pathname: `/v1${req.url}`,
        body,
        env: serverEnv,
        clientId: req.socket?.remoteAddress || 'local',
        limiter,
        enforceRecipientAllowlist: false
      });

      if (!verdict.ok) {
        res.statusCode = verdict.status;
        res.setHeader('content-type', 'application/json');
        if (verdict.retryAfterSeconds) res.setHeader('retry-after', String(verdict.retryAfterSeconds));
        res.end(JSON.stringify({ error: verdict.error }));
        return;
      }

      const headers = {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json'
      };
      if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
      // The idempotency key is chosen by the client and must survive the hop,
      // otherwise a retry through the proxy would place a second call.
      if (req.headers['idempotency-key']) headers['idempotency-key'] = req.headers['idempotency-key'];

      try {
        const upstream = await fetch(target, { method: req.method, headers, body });
        const text = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
        res.end(text);
      } catch (err) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: { code: 'provider_unavailable', message: `Could not reach CALL-E: ${err.message}`, details: {} }
        }));
      }
    });
  };

  return {
    name: 'call-e-proxy',
    config(_config, env) {
      const fileEnv = loadEnv(env.mode || 'development', process.cwd(), 'CALLE');
      serverEnv = {
        ...fileEnv,
        ...process.env,
        CALLE_INCIDENT_STORE_PATH:
          process.env.CALLE_INCIDENT_STORE_PATH || fileEnv.CALLE_INCIDENT_STORE_PATH || DEFAULT_STORE_PATH
      };

      apiKey = readServerKey(env.mode);
      rota = readServerRota(env.mode);

      // Announced once at startup so it is obvious which mode the app is in
      // before anyone tries to page a rota.
      console.log(apiKey
        ? '[call-e] Server key loaded. Live calls enabled, key stays on the server.'
        : '[call-e] No CALLE_API_KEY found. Running in simulation mode. Add one to .env to place real calls.');
      console.log(rota.length
        ? `[call-e] Rota seeded from .env: ${rota.map((c) => `${c.id} ${c.phone || 'no number'}`).join(', ')}`
        : '[call-e] No rota seeded. Set CALLE_ROTA_PRIMARY_PHONE in .env to prefill the dialog.');

      // Says what a deployment of this same tree would allow, because that is
      // the number people forget to set and only discover from a refusal after
      // the link is already in a submission.
      const allowed = readAllowedNumbers(serverEnv);
      console.log(allowed.length
        ? `[call-e] A public deployment of this tree would ring ${allowed.length} allowed destination(s). Locally, any number you enter is dialled.`
        : '[call-e] A public deployment of this tree would refuse every call: no CALLE_DEMO_ALLOWED_NUMBERS and no rota numbers set. Locally, any number you enter is dialled.');

      const webhookUrl = (serverEnv.CALLE_WEBHOOK_URL || '').trim();
      console.log(webhookUrl
        ? `[call-e] Terminal call events will be delivered to ${webhookUrl}, so an escalation survives a closed tab.`
        : '[call-e] No CALLE_WEBHOOK_URL set, so call state is followed by polling and stops when the tab closes.');
    },
    configureServer: attach,
    configurePreviewServer: attach
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default defineConfig({
  plugins: [callEProxy()],
  resolve: {
    alias: {
      'node:crypto': path.resolve(__dirname, './src/lib/cryptoShim.js')
    }
  }
});

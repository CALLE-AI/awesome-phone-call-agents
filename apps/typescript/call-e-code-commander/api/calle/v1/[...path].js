/**
 * Deployed CALL-E proxy.
 *
 * Mirrors the middleware in vite.config.js so a hosted build behaves exactly
 * like a local one. The key is attached here, on the server, and never reaches
 * the page. Requests arriving from the browser carry no credential at all.
 *
 * The difference between this copy and the dev one is who can reach it. A dev
 * server listens on the operator's own machine. This listens on the public
 * internet, so every request is put through the shared guard first, and the
 * recipient allowlist is enforced here and only here. Without that, publishing
 * a link to this deployment would be publishing an anonymous dialler that
 * spends the owner's balance and calls whoever the caller names.
 */

import { guardProxyRequest, RateLimiter } from '../../_lib/proxyGuard.js';

const CALLE_API = 'https://api.heycall-e.com';

// Held per instance. A serverless host may run several, so this bounds a burst
// rather than guaranteeing a global ceiling, which is why it is the last of the
// three controls and not the only one.
const limiter = new RateLimiter();

// The raw body is forwarded untouched, so a parsed-and-restringified payload
// can never differ from what the page actually sent.
export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Best available identifier for the caller, for rate limiting only. */
function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded.length) return String(forwarded[0]).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  const apiKey = (process.env.CALLE_API_KEY || '').trim();

  if (!apiKey) {
    res.status(503).json({
      error: {
        code: 'proxy_not_configured',
        message: 'No CALLE_API_KEY in the deployment environment. Set it in the hosting provider and redeploy.',
        details: {}
      }
    });
    return;
  }

  const incoming = new URL(req.url, 'http://proxy.local');
  const suffix = incoming.pathname.replace(/^\/api\/calle/, '');

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') body = await readBody(req);

  const verdict = guardProxyRequest({
    method: req.method,
    pathname: suffix,
    body,
    env: process.env,
    clientId: clientAddress(req),
    limiter,
    // The control that stops this deployment being used to call a stranger.
    enforceRecipientAllowlist: true
  });

  if (!verdict.ok) {
    if (verdict.retryAfterSeconds) res.setHeader('retry-after', String(verdict.retryAfterSeconds));
    res.status(verdict.status).json({ error: verdict.error });
    return;
  }

  const target = `${CALLE_API}${suffix}${incoming.search}`;

  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json'
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  // Chosen by the client and must survive the hop, otherwise a retry through
  // the proxy would place a second call to a sleeping engineer.
  if (req.headers['idempotency-key']) headers['idempotency-key'] = req.headers['idempotency-key'];

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: { code: 'provider_unavailable', message: `Could not reach CALL-E: ${err.message}`, details: {} }
    });
  }
}

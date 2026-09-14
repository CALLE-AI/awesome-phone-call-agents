/**
 * Deployed equivalent of the dev server's mode endpoint.
 *
 * The Vite plugin in vite.config.js only runs under `npm run dev` and
 * `npm run preview`. A production build is static files, so a deployed copy has
 * no server to hold the key and falls back to a labelled simulation. That is
 * safe, but it means a reviewer opening the hosted link never sees a phone ring.
 *
 * These functions are that server. They are the same arrangement as the dev
 * proxy: the key is read from the platform's environment, the page asks which
 * mode it is in, and requests leaving the browser carry no credential.
 */

import { readRotaFromEnv } from '../../src/config/rota.js';
import { readAllowedNumbers } from '../_lib/proxyGuard.js';
import { getIncidentStore } from '../_lib/incidentStore.js';

export default function handler(req, res) {
  const apiKey = (process.env.CALLE_API_KEY || '').trim();
  const allowed = readAllowedNumbers(process.env);
  const webhookUrl = (process.env.CALLE_WEBHOOK_URL || '').trim();

  res.setHeader('content-type', 'application/json');
  // The answer depends on server configuration, not on the request, but it must
  // not be cached across a key change.
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    serverKey: Boolean(apiKey),
    baseUrl: apiKey ? '/api/calle' : null,
    rota: readRotaFromEnv(process.env),
    // Where CALL-E should post terminal call state. Absolute HTTPS or nothing:
    // the page will not ask for delivery to an address that cannot receive it.
    webhookUrl: /^https:\/\//i.test(webhookUrl) ? webhookUrl : null,
    // How many destinations this deployment may ring, never which ones. The
    // count is what the page needs to explain a refusal. The numbers themselves
    // are people's mobiles and have no business being served to a browser.
    dialling: {
      restricted: true,
      allowedCount: allowed.length
    },
    incidentStore: {
      persistent: getIncidentStore(process.env).isPersistent
    }
  });
}

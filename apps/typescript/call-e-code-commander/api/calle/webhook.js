/**
 * Terminal call events from CALL-E.
 *
 * Configure this URL as `webhook_url` on the call, or as the project webhook in
 * the dashboard, and CALL-E posts here once a call reaches a terminal state and
 * its structured result is finalised. That is what lets an escalation outlive
 * the browser tab that started it.
 *
 * The trust model is in api/_lib/webhookReceiver.js and is the part worth
 * reading: this endpoint is unauthenticated by the platform's own design, so
 * the delivery is treated as a notification and every recorded fact is re-read
 * from the CALL-E API with the server key before it is written down.
 */

import { getIncidentStore } from '../_lib/incidentStore.js';
import { handleWebhookDelivery } from '../_lib/webhookReceiver.js';

export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Webhook deliveries are POSTed.' });
    return;
  }

  const rawBody = await readBody(req);
  const token = new URL(req.url, 'http://receiver.local').searchParams.get('token');

  const result = await handleWebhookDelivery({
    rawBody,
    token,
    env: process.env,
    store: getIncidentStore(process.env)
  });

  res.status(result.status).json(result.body);
}

/**
 * CALL-E webhook receiver.
 *
 * Polling from the browser only works while somebody is watching the browser.
 * A webhook is what lets the escalation outlive the tab: CALL-E posts the
 * terminal state of a call task, and the outcome is recorded server-side
 * whether or not anyone is still on the page.
 *
 * The delivery itself cannot be trusted, and this is the important part.
 *
 * The SDK ships signature helpers and marks both of them deprecated, with the
 * reason stated plainly: current CALL-E webhook deliveries are not signed and
 * carry no signature headers. So the request arriving at this endpoint is an
 * unauthenticated POST from the public internet. Its body contains a complete,
 * well-formed call task, including a structured result saying who answered and
 * what they authorised. Reading a deploy authorisation out of that body would
 * mean anybody who guessed this URL could ship code to production by sending a
 * JSON document.
 *
 * The delivery is therefore treated as a notification and never as evidence.
 * The only field taken from it is the call id. Everything the audit trail
 * records is then re-read from the CALL-E API with the server key, over TLS, on
 * a connection the account authenticates. A forged delivery for a call that does
 * not exist reads back as nothing. A forged delivery naming a real call reads
 * back the real outcome, which is the outcome that was already true. In both
 * cases the attacker supplies no facts.
 *
 * `CALLE_WEBHOOK_TOKEN` adds a shared secret in the query string. It is a spam
 * gate that keeps unsolicited traffic out of the read path, and it is documented
 * here as exactly that: it is sent in a URL, so it is not authentication, and
 * nothing in the trust model rests on it.
 */

import { CalleIncidentCommander } from '../../src/agents/calleService.js';

/** Terminal event types CALL-E delivers. */
export const WEBHOOK_EVENT_TYPES = ['call.completed', 'call.failed', 'call.result_validation_failed'];

/**
 * Parses a raw delivery body into an event envelope.
 *
 * @param {Buffer|string} rawBody
 * @returns {{ok: boolean, event: object|null, error: string|null}}
 */
export function parseWebhookDelivery(rawBody) {
  let text;
  try {
    text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  } catch {
    return { ok: false, event: null, error: 'Delivery body could not be read.' };
  }

  if (!text.trim()) return { ok: false, event: null, error: 'Delivery body was empty.' };

  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return { ok: false, event: null, error: 'Delivery body was not valid JSON.' };
  }

  if (!event || typeof event !== 'object') {
    return { ok: false, event: null, error: 'Delivery body was not an object.' };
  }

  const callId = event.data?.id;
  if (typeof callId !== 'string' || !callId) {
    return { ok: false, event: null, error: 'Delivery carried no call id, so there is nothing to verify against the API.' };
  }

  if (typeof event.type === 'string' && !WEBHOOK_EVENT_TYPES.includes(event.type)) {
    // Not rejected. An unrecognised terminal type is still a signal that this
    // call reached an end state, and the outcome is read from the API anyway.
    // Refusing it would mean a new event type silently stalled the ladder.
  }

  return { ok: true, event, error: null };
}

/**
 * Checks the optional shared-secret query parameter.
 *
 * Returns true when no token is configured, because the endpoint is safe
 * without one. Nothing is believed on the strength of this check.
 */
export function isExpectedDelivery(providedToken, env = {}) {
  const expected = (env.CALLE_WEBHOOK_TOKEN || '').trim();
  if (!expected) return true;
  return typeof providedToken === 'string' && providedToken === expected;
}

/**
 * Handles one delivery.
 *
 * @param {object} input
 * @param {Buffer|string} input.rawBody
 * @param {string|null} [input.token] Token from the query string, if any.
 * @param {Record<string, string|undefined>} input.env
 * @param {import('./incidentStore.js').IncidentStore} input.store
 * @param {(callId: string) => Promise<object|null>} [input.verifyCall] Injected for tests.
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleWebhookDelivery({ rawBody, token = null, env = {}, store, verifyCall = null }) {
  if (!isExpectedDelivery(token, env)) {
    return { status: 401, body: { ok: false, error: 'Unrecognised delivery token.' } };
  }

  const parsed = parseWebhookDelivery(rawBody);
  if (!parsed.ok) {
    // A 4xx tells CALL-E not to retry something that will never parse.
    return { status: 400, body: { ok: false, error: parsed.error } };
  }

  const event = parsed.event;
  const callId = event.data.id;

  // Claimed before the side effect, which is what the event id is documented
  // for. A redelivery of an event already recorded is acknowledged and dropped.
  if (event.id && !store.claimEvent(event.id)) {
    return { status: 200, body: { ok: true, duplicate: true, callId } };
  }

  const verify = verifyCall || defaultVerifier(env);
  let verified;
  try {
    verified = await verify(callId);
  } catch (err) {
    // A read failure is temporary. Answering 5xx asks CALL-E to deliver again
    // rather than dropping an outcome because the API blinked.
    return { status: 503, body: { ok: false, error: `Could not verify call ${callId} against the CALL-E API.` } };
  }

  if (!verified?.snapshot) {
    // The delivery named a call this account cannot read. Either it was forged,
    // or it belongs to another project. Acknowledged so it is not retried
    // forever, and nothing is recorded.
    return { status: 200, body: { ok: true, recorded: false, reason: 'No such call on this account.', callId } };
  }

  const { snapshot, outcome, metadata } = verified;
  const incidentId = metadata?.incident_id;

  if (!incidentId) {
    return { status: 200, body: { ok: true, recorded: false, reason: 'Verified call carried no incident id.', callId } };
  }

  store.recordCall(incidentId, {
    callId,
    // Both timestamps kept: when CALL-E raised the event, and when this server
    // wrote it down. A gap between them is the delivery delay, which a reviewer
    // asking "why did nobody act for nine minutes" will want.
    eventType: event.type || 'unknown',
    eventId: event.id || null,
    eventAt: event.created_at || null,
    recordedAt: new Date().toISOString(),
    verifiedFromApi: true,
    contactId: metadata.contact_id || null,
    contactRole: metadata.contact_role || null,
    escalatedFrom: metadata.escalated_from || null,
    status: snapshot.status,
    decision: outcome.decision,
    answeredBy: outcome.answeredBy,
    authorised: outcome.authorised,
    shouldEscalate: outcome.shouldEscalate,
    reason: outcome.reason,
    confidence: outcome.confidence,
    callbackMinutes: outcome.callbackMinutes ?? null,
    failureCode: snapshot.failureCode || null,
    transcript: snapshot.transcript || []
  });

  return {
    status: 200,
    body: { ok: true, recorded: true, incidentId, callId, decision: outcome.decision, authorised: outcome.authorised }
  };
}

/**
 * Reads a call from the CALL-E API and interprets it with the same rules the
 * ladder uses.
 *
 * Reusing `interpretDecision` here is the point. A second implementation of
 * "may this authorise a deploy" living in the webhook path is how a system ends
 * up with a back door that is more permissive than its front door.
 */
function defaultVerifier(env) {
  return async (callId) => {
    const key = (env.CALLE_API_KEY || '').trim();
    if (!key) throw new Error('No server key configured, so no delivery can be verified.');

    const commander = new CalleIncidentCommander(key);
    const snapshot = await commander.pollCall(callId);
    if (!snapshot || snapshot.error) return null;

    return {
      snapshot,
      outcome: commander.interpretDecision(snapshot),
      metadata: snapshot.metadata || {}
    };
  };
}

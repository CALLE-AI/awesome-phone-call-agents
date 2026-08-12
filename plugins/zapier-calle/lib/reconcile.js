import { baseUrl } from './client.js';

// Both webhook surfaces - the resumable callback and the static Call Completed
// trigger - receive an unsigned HTTP body from an unauthenticated URL. CALL-E
// publishes no signing secret and no subscription handshake, so nothing in the
// request proves it came from CALL-E. Matching a call id does not help: the id
// arrives in the same untrusted body, and an id an attacker already knows is
// an id they can echo back.
//
// So the body is treated as a notification, not as evidence. It says "call X
// may be finished"; this module asks CALL-E directly, over the connection's
// own authenticated API key, what actually happened to call X. Every field a
// Zap acts on then comes from that authenticated response. A forged POST can
// at most cause an extra authenticated lookup of a call the account can
// already see.
const EVENT_TYPE_BY_STATUS = {
  completed: 'call.completed',
  failed: 'call.failed',
  canceled: 'call.completed',
  queued: 'call.completed',
  in_progress: 'call.completed',
};

// Wraps an authoritative call record in the webhook-event shape the classifier
// reads. `overrides` carries the envelope fields of a real delivery - its event
// id and type. Passing an untrusted type through is deliberate and safe: the
// data being classified is the authenticated record, and a wrong type can only
// move the verdict toward *less* actionable (an unrecognized type resolves to
// needs_human, call.failed to failed). It cannot manufacture a confirmed result
// for a call that CALL-E does not report as a clean success.
export function syntheticEvent(data, overrides = {}) {
  return {
    id: overrides.id || `lookup_${data.id}`,
    type: overrides.type || EVENT_TYPE_BY_STATUS[data.status] || 'call.completed',
    created_at: data.completed_at || data.created_at,
    data,
  };
}

const notVerified = (reason, notFound = false) => ({ ok: false, notFound, reason });

export async function fetchAuthoritativeCall(z, bundle, callId) {
  if (typeof callId !== 'string' || callId.trim() === '') {
    return notVerified('No call id was available to confirm the outcome with CALL-E.');
  }
  if (!z || typeof z.request !== 'function') {
    return notVerified('No CALL-E client was available to confirm the outcome with.');
  }

  let response;
  try {
    // skipThrowForStatus so a 404 - "this connection has no such call" - can be
    // told apart from a transient outage. One means the payload was not about a
    // call we own; the other means we simply could not check.
    response = await z.request({
      url: `${baseUrl(bundle)}/v1/calls/${encodeURIComponent(callId.trim())}`,
      skipThrowForStatus: true,
    });
  } catch (error) {
    return notVerified(`CALL-E could not be reached to confirm the outcome: ${error.message}`);
  }

  const status = response && response.status;
  if (status === 404) {
    return notVerified('CALL-E has no such call on this connection.', true);
  }
  if (typeof status === 'number' && status >= 400) {
    return notVerified(`CALL-E returned status ${status} when asked to confirm the outcome.`);
  }

  const data = response && response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return notVerified('CALL-E returned no readable record for this call.');
  }
  if (data.id !== callId.trim()) {
    return notVerified('CALL-E returned a record for a different call than the one asked about.');
  }

  return { ok: true, notFound: false, data };
}

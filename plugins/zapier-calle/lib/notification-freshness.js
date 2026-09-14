// The static Call Completed webhook is an unauthenticated URL carrying an
// unsigned body. Re-reading the call from CALL-E (lib/reconcile.js) proves the
// *record* is real and belongs to this connection - but it proves nothing
// about the notification that named it. Anyone who learns the URL and one
// valid call id can POST that id again, with a fresh envelope id every time,
// and each POST re-reads the same genuine, long-finished result.
//
// Ownership is verifiable server-side: a call this connection cannot see gets
// a 404. Freshness is verifiable server-side too, and this module is where:
// CALL-E stamps `completed_at` on the call record itself - "when the complete
// terminal call result was published", per the OpenAPI schema, and null until
// then. A legitimate delivery follows that publication by seconds. A replay of
// an old result cannot make the timestamp recent, because the timestamp is not
// in the attacker's copy of the body; it comes back from the authenticated
// read.
//
// So this bounds *when* a notification may be believed. It cannot bound *how
// often*: two POSTs seconds apart are indistinguishable, and a Zapier trigger
// has no durable storage to remember an id in (z.cursor belongs to polling
// triggers). That half is answered in triggers/call-completed.js, by no longer
// letting this surface mark anything actionable.
//
// NOTE: the ceiling is the window itself - a replay landing inside it still
// reports the true, current outcome. The upgrade path is webhook signing: an
// HMAC over the raw body plus a timestamp header would authenticate the
// notification directly and make this whole module unnecessary. Asked of
// CALL-E support; see docs/fail-closed-dispositions.md section 11.
export const MAX_NOTIFICATION_AGE_MINUTES = 15;

// CALL-E's clock and Zapier's are not the same clock. A result stamped a
// little ahead of us is ordinary skew; one stamped far ahead is not something
// an age can be measured from at all.
const CLOCK_SKEW_TOLERANCE_MINUTES = 2;

const MS_PER_MINUTE = 60000;

const stale = (reason) => ({ fresh: false, reason });

// `data` is the authoritative record from GET /v1/calls/{id}, never the
// delivered body. `now` is passed in so this stays a pure function.
export function checkNotificationFreshness(data, now) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return stale('The call record could not be read, so the notification could not be dated.');
  }

  const completedAt = data.completed_at;
  if (completedAt === null || completedAt === undefined || completedAt === '') {
    return stale(
      'CALL-E has published no terminal result for this call, so there is nothing for this ' +
        'notification to be reporting yet.',
    );
  }

  const publishedAt = Date.parse(completedAt);
  if (!Number.isFinite(publishedAt)) {
    return stale('CALL-E\'s completion timestamp could not be read as a date.');
  }

  const ageMinutes = (now - publishedAt) / MS_PER_MINUTE;
  if (ageMinutes < -CLOCK_SKEW_TOLERANCE_MINUTES) {
    return stale('CALL-E\'s completion timestamp is in the future, so the age of this notification is unknown.');
  }
  if (ageMinutes > MAX_NOTIFICATION_AGE_MINUTES) {
    return stale(
      `CALL-E published this result ${ageMinutes.toFixed(1)} minutes ago, past the ` +
        `${MAX_NOTIFICATION_AGE_MINUTES} minute freshness limit, so this delivery is a repeat ` +
        'or a replay of an already-finished call rather than news of one.',
    );
  }

  return { fresh: true, reason: null };
}

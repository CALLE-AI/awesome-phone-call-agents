import { flattenResult } from '../lib/flatten-result.js';
import { toMinConfidenceScore } from '../lib/result-quality.js';
import { fetchAuthoritativeCall, syntheticEvent } from '../lib/reconcile.js';
import { checkNotificationFreshness } from '../lib/notification-freshness.js';
import { toLeadState } from '../lib/lead-state.js';

// Re-reading the call from CALL-E proves the record is real and belongs to this
// connection. It cannot prove that the POST which named that call was authorized
// or new. Anyone who learns this URL and one valid call id can send it again,
// with a fresh envelope id each time, and every send re-reads the same genuine
// result - so a Zap acting on this trigger's output would act again, and again,
// on a call that happened once.
//
// Two things follow, and both are enforced below.
//
// Freshness *is* checkable server-side, so it is checked: lib/notification-
// freshness.js dates the outcome by CALL-E's own `completed_at`, which arrives
// in the authenticated response rather than in the attacker's copy of the body.
// A replayed old result is therefore reported as needs_human, not as confirmed.
//
// At-most-once is not checkable here, so this surface no longer claims it. A
// duplicate POST landing inside the freshness window is indistinguishable from a
// legitimate redelivery, and a Zapier trigger has no durable storage to remember
// an id in - z.cursor belongs to polling triggers, and inventing dedup on an
// undocumented channel would look like a control while silently being none. So
// `is_actionable` is never true here. The full authenticated outcome is still
// reported, for routing, alerting and branching; anything that writes, pays or
// notifies should re-read the call through `Find Call Result`, which reads from
// CALL-E directly and has no webhook to distrust.
const NOT_ACTIONABLE_NOTE =
  'This outcome arrived on an unauthenticated webhook URL that anyone who learns it can post to ' +
  'again, so it is reported for routing only and is never marked actionable. Look the call up ' +
  'with Find Call Result over your own connection before acting on it, and key whatever you ' +
  'write to `call_id` so a repeated delivery cannot write twice.';

// This trigger deliberately omits performSubscribe/performUnsubscribe. The
// CALL-E Developer API exposes no webhook subscription endpoint to call
// from those hooks, so there is nothing to subscribe or unsubscribe from.
// Leaving both out is what makes Zapier render this trigger as a *static*
// webhook: the Zap editor shows a URL for the user to copy and paste into
// CALL-E's own settings, instead of Zapier registering it automatically.
// Static webhooks are only permitted on private Zapier integrations, which
// this one is.
const classifierOptions = (bundle) => ({
  minConfidenceScore: toMinConfidenceScore(bundle.inputData && bundle.inputData.min_confidence_score),
});

const perform = async (z, bundle) => {
  const event = bundle.cleanedRequest;

  // The webhook endpoint is unauthenticated: CALL-E has no signing secret
  // or subscription handshake to verify a delivery against, so a payload
  // reaching this trigger could be a real CALL-E event or a forged POST
  // from anyone who has discovered the URL.
  //
  // Fail closed on shape rather than throw: a malformed or empty POST body
  // means there is nothing to trigger on, and returning [] tells Zapier
  // exactly that instead of erroring the user's Zap.
  if (!event || typeof event !== 'object' || !event.data || typeof event.data !== 'object') {
    return [];
  }

  // The delivered body is a notification, never evidence. The only thing taken
  // from it is the call id it names - and that id is then handed to CALL-E over
  // this connection's own API key, so every field the Zap goes on to act on
  // comes from an authenticated response rather than from whoever POSTed here.
  const claimedCallId = event.data.id;
  const authoritative = await fetchAuthoritativeCall(z, bundle, claimedCallId);

  // A call this connection cannot see is not this Zap's call - a forged POST,
  // a stale delivery, or a webhook wired to the wrong CALL-E project. Trigger
  // nothing at all rather than manufacture a run for it.
  if (authoritative.notFound) {
    return [];
  }

  // Any other failure means the lookup could not be done, not that the call is
  // fake - CALL-E being briefly unreachable must not silently swallow a real
  // outcome. Surface it, from the delivered body, marked unverified and never
  // actionable, so a human sees the call rather than losing it.
  if (!authoritative.ok) {
    const unverified = flattenResult(event, classifierOptions(bundle));
    return [
      {
        ...unverified,
        disposition: 'needs_human',
        disposition_reason:
          'A call outcome was received on the webhook URL, but it could not be confirmed ' +
          `with CALL-E, so nothing in it may be acted on. ${authoritative.reason}`,
        is_actionable: false,
        lead_state: toLeadState('needs_human'),
        notification_fresh: false,
        verified: false,
      },
    ];
  }

  // No result_schema is available to a trigger - this webhook may describe a
  // call placed from CALL-E's CLI, an MCP tool, or another Zap entirely, so
  // there is no declared contract to hold the result to. The classifier
  // therefore runs its schemaless check: it can still see that a returned
  // field came back `unknown` or empty, but it cannot know that a field the
  // original caller required is absent.
  const verifiedEvent = syntheticEvent(authoritative.data, { id: event.id, type: event.type });
  const flat = flattenResult(verifiedEvent, classifierOptions(bundle));

  // `verified` stays true either way: the call record was confirmed with CALL-E.
  // What a stale timestamp impeaches is the notification, not the record, which
  // is why freshness gets a field of its own rather than overloading that one.
  const freshness = checkNotificationFreshness(authoritative.data, Date.now());
  const stale = !freshness.fresh;

  // A stale delivery only *downgrades a success*. `failed`, `review_required`
  // and the rest are already non-actionable and already say something more
  // specific than needs_human does, and every legitimate late redelivery would
  // trip this - so replacing them would cost information and buy nothing. What
  // must not survive a replay is `confirmed`, because branching on it is
  // precisely what a Zap is told to do.
  const downgraded = stale && flat.disposition === 'confirmed';

  return [
    {
      ...flat,
      disposition: downgraded ? 'needs_human' : flat.disposition,
      disposition_reason: [flat.disposition_reason, stale ? freshness.reason : null, NOT_ACTIONABLE_NOTE]
        .filter(Boolean)
        .join(' '),
      is_actionable: false,
      lead_state: downgraded ? toLeadState('needs_human') : flat.lead_state,
      notification_fresh: freshness.fresh,
      verified: true,
    },
  ];
};

export default {
  key: 'call_completed',
  noun: 'Call',
  display: {
    label: 'Call Completed',
    description:
      'Triggers when any CALL-E call reaches a terminal state (completed, failed, or ' +
      'result validation failed) - including calls started outside Zapier, such as from ' +
      "CALL-E's CLI or MCP tools. Requires pasting the webhook URL Zapier provides into " +
      "your CALL-E project's webhook settings; see the setup directions for this trigger. " +
      'Outcomes arrive here for routing and review, never marked actionable: use Find Call ' +
      'Result before a step that writes, pays or notifies.',
    // Zapier caps `directions` at 1000 characters, so this is the operational
    // short form; README.md carries the reasoning behind the last paragraph.
    directions:
      'Zapier cannot poll CALL-E: its API has no endpoint that lists calls. This trigger ' +
      'listens for a webhook CALL-E sends directly, so connect the two by hand:\n\n' +
      '1. Copy the webhook URL Zapier shows below.\n' +
      "2. In CALL-E, open your project's webhook settings.\n" +
      '3. Paste the URL in and save.\n\n' +
      'Every terminal call in that project then reaches this Zap.\n\n' +
      'The URL is unauthenticated, so nothing arriving on it is trusted: each outcome is ' +
      're-read from CALL-E over your own connection first. A delivery naming a call you ' +
      'cannot see is ignored; one that cannot be confirmed arrives as needs_human, verified ' +
      'false.\n\n' +
      'Re-reading proves the call is real, not that the delivery was authorized or new - ' +
      'anyone who learns this URL can post a call id again. So an outcome published over 15 ' +
      'minutes ago arrives as needs_human, notification_fresh false, and nothing here is ' +
      'ever actionable. Before a step that writes or notifies, look the call up with Find ' +
      'Call Result and key what you write to call_id.',
  },
  operation: {
    type: 'hook',
    inputFields: [
      {
        key: 'min_confidence_score',
        label: 'Minimum Confidence Score',
        type: 'string',
        required: false,
        default: '0.6',
        helpText:
          'A result is only marked confirmed when CALL-E\'s 0-1 confidence score is at least this value. Set to 0 to accept the confidence label alone.',
      },
    ],
    perform,
    sample: {
      disposition: 'confirmed',
      disposition_reason:
        'Call completed with a high-confidence validated result. This outcome arrived on an ' +
        'unauthenticated webhook URL, so it is reported for routing only and is never marked ' +
        'actionable.',
      is_actionable: false,
      lead_state: 'qualified',
      notification_fresh: true,
      verified: true,
      opt_out_requested: false,
      event_id: 'evt_123',
      event_type: 'call.completed',
      call_id: 'call_123',
      status: 'completed',
      task_completed: true,
      confidence_label: 'high',
      confidence_score: 0.92,
      summary: 'The engineer acknowledged the incident.',
      correlation_id: 'incident-42',
      recipients_total: 1,
      recipients_completed: 1,
      recipients_failed: 0,
      transcript_text: 'bot: Are you able to take this incident?\nuser: Yes, on it.',
    },
  },
};

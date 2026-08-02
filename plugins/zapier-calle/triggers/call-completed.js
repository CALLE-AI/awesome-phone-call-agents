import { flattenResult } from '../lib/flatten-result.js';

// This trigger deliberately omits performSubscribe/performUnsubscribe. The
// CALL-E Developer API exposes no webhook subscription endpoint to call
// from those hooks, so there is nothing to subscribe or unsubscribe from.
// Leaving both out is what makes Zapier render this trigger as a *static*
// webhook: the Zap editor shows a URL for the user to copy and paste into
// CALL-E's own settings, instead of Zapier registering it automatically.
// Static webhooks are only permitted on private Zapier integrations, which
// this one is.
const perform = async (z, bundle) => {
  const event = bundle.cleanedRequest;

  // The webhook endpoint is unauthenticated: CALL-E has no signing secret
  // or subscription handshake to verify a delivery against, so a payload
  // reaching this trigger could be a real CALL-E event or a forged POST
  // from anyone who has discovered the URL. flattenResult still runs every
  // field through redactDeep (masking phone numbers), but that is data
  // hygiene, not proof of origin - a downstream Zap should branch on
  // `disposition` and must not treat `correlation_id` as authenticated,
  // since it is just an echoed value, not a verified one.
  //
  // Fail closed on shape rather than throw: a malformed or empty POST body
  // means there is nothing to trigger on, and returning [] tells Zapier
  // exactly that instead of erroring the user's Zap.
  if (!event || typeof event !== 'object' || !event.data || typeof event.data !== 'object') {
    return [];
  }

  return [flattenResult(event)];
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
      "your CALL-E project's webhook settings; see the setup directions for this trigger.",
    directions:
      'Zapier cannot poll CALL-E for new calls, because the CALL-E API has no endpoint ' +
      'that lists them. Instead, this trigger listens for a webhook that CALL-E sends ' +
      'directly, so you connect the two manually:\n\n' +
      "1. Copy the webhook URL Zapier shows below this trigger once it's set up.\n" +
      "2. In CALL-E, open your project's webhook settings.\n" +
      "3. Paste the copied URL into the project's webhook URL field and save.\n\n" +
      'Once connected, every call your CALL-E project places - whether started from a Zap, ' +
      "the CALL-E CLI, an MCP tool, or anywhere else - will send its terminal outcome to " +
      'this Zap. This URL is unauthenticated, so treat it like any other shared secret, ' +
      'and branch your Zap on the `disposition` field rather than assuming every event it ' +
      'receives came from a real CALL-E call.',
  },
  operation: {
    type: 'hook',
    perform,
    sample: {
      disposition: 'confirmed',
      disposition_reason: 'Call completed with a high-confidence validated result.',
      is_actionable: true,
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

/**
 * CALL-E Incident Commander — Developer Platform Integration
 *
 * This module is the control plane for the whole application. The phone call is
 * not a notification here: it is the mechanism that produces the authoritative,
 * auditable decision about whether a production hotfix ships.
 *
 * CALL-E surface used:
 *   client.calls.create()      — place the outbound call, with an Idempotency-Key
 *   client.calls.get()         — poll lifecycle, attempts, transcript turns
 *   client.calls.listEvents()  — stream developer events into the incident timeline
 *   recipientResultSchema      — extract the engineer's spoken decision as typed JSON
 *   metadata                   — carry incident correlation IDs through to webhooks
 *   region / locale            — resolved from published coverage before dialling
 *   completionConfidence       — corroborate a decision, never authorise one
 */

import { CalleClient } from '@call-e/calle';
import { resolveRegion } from './regions.js';

/**
 * The typed decision CALL-E must extract from the spoken conversation.
 *
 * Everything downstream — whether the hotfix deploys, whether we roll back,
 * whether we wake up the next person on the rota — is driven by this object.
 *
 * Object schemas are strict by default on this platform, and `additionalProperties`
 * is set to false to say so explicitly. The cost is that an off-schema extraction
 * comes back as null rather than as a partial result. That is the right trade
 * here: a null result fails closed and escalates, whereas a loosely validated
 * one could put an unrecognised value in front of the authorisation check.
 */
export const INCIDENT_DECISION_SCHEMA = {
  type: 'object',
  required: ['answered_by', 'decision'],
  additionalProperties: false,
  properties: {
    // CALL-E's schema guidance is to prefer string enums over booleans for
    // judgements that may be unclear, and to include an explicit unknown value.
    // This is the field that decides whether code ships, so an ambiguous call
    // must be able to say "I am not sure" instead of being forced to a boolean.
    // The Calls API returns no built-in answered-by disposition, so the endpoint
    // classification is defined here as a per-recipient structured result, which
    // is the pattern the platform documents for this.
    answered_by: {
      type: 'string',
      enum: ['named_engineer', 'different_person', 'voicemail_or_ivr', 'no_answer', 'unknown'],
      description: 'Classify the final endpoint of the call. Use named_engineer only when a live person confirmed they are the engineer you asked for. Use different_person when a live person answered but is someone else. If an IVR or switchboard transfers the call to a person, classify by who you ended up speaking to, not by the menu. Use voicemail_or_ivr when the call ended at a recording, answering machine, or automated menu with no human. Use no_answer when nobody picked up. Use unknown if the evidence is genuinely unclear.'
    },
    decision: {
      type: 'string',
      enum: ['deploy_hotfix', 'hold_for_review', 'rollback_release', 'escalate_to_backup', 'no_decision'],
      description: 'The action the engineer authorised in their own words. Use deploy_hotfix only if they clearly said to deploy or ship it. Use no_decision if nobody answered, or they spoke but never committed to one of these actions.'
    },
    reason: {
      type: 'string',
      description: 'The engineer\'s stated reasoning, quoted or closely paraphrased from what they actually said. Leave empty if they gave none.'
    },
    acknowledged_severity: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Whether the engineer confirmed they understood the severity and the customer impact. Use unknown if it did not come up.'
    },
    callback_minutes: {
      type: 'integer',
      description: 'If the engineer asked for time before deciding, how many minutes they asked for. Use 0 if they decided during the call.'
    },
    questions_asked: {
      type: 'array',
      items: { type: 'string' },
      description: 'Questions the engineer asked about the incident during the call. Empty array if they asked none.'
    }
  }
};

/**
 * Whether the transcript so far contains a turn spoken by someone other than
 * CALL-E.
 *
 * The Calls API reports an attempt as `in_progress` from the moment it starts
 * dialling, so that status means a call is under way, not that a person picked
 * up. A rung can sit in `in_progress` for three minutes and end as no answer.
 * Rendering it as "on the line" would put a green badge and a person's name on
 * screen while their phone was still ringing, which is the same overstatement
 * this project refuses to make anywhere else.
 *
 * A recipient turn in the transcript is positive evidence that somebody is
 * talking. It is the earliest thing CALL-E returns that actually establishes
 * that, short of the final structured result.
 *
 * @param {Array<{speaker?: string}>|null|undefined} transcript
 * @returns {boolean}
 */
export function hasRecipientTurn(transcript) {
  if (!Array.isArray(transcript)) return false;
  return transcript.some((turn) => {
    if (!turn) return false;
    // Live turns carry the flag set when the API response was read.
    if (typeof turn.fromRecipient === 'boolean') return turn.fromRecipient;
    // Simulated transcripts are authored with display names only. An unattributed
    // or unrecognised speaker is not evidence that a person is talking, so both
    // fail closed rather than turning a rung green.
    const speaker = (turn.speaker || '').trim();
    if (speaker === '' || speaker.toLowerCase() === 'unknown') return false;
    return !/^call[\s_-]?e$/i.test(speaker);
  });
}

/** The endpoint classifications the decision schema allows. */
const ANSWERED_BY_VALUES = new Set(INCIDENT_DECISION_SCHEMA.properties.answered_by.enum);

/**
 * Reads `answered_by` out of a structured result, defaulting to `unknown`.
 *
 * Anything off-schema is treated as unknown rather than passed through. Only
 * `named_engineer` can authorise a change, so an unrecognised value has to fail
 * closed, and a value that is not in the enum has no meaning downstream anyway.
 *
 * @param {object|null|undefined} result
 * @returns {string} One of the schema's answered_by values.
 */
function readAnsweredBy(result) {
  const value = result?.answered_by;
  return typeof value === 'string' && ANSWERED_BY_VALUES.has(value) ? value : 'unknown';
}

/** Call task lifecycle states that will never change again. */
const TERMINAL_CALL_STATUSES = new Set(['completed', 'failed', 'canceled']);

/** Decisions that authorise a production change. */
const AUTHORISING_DECISIONS = new Set(['deploy_hotfix', 'rollback_release']);

/**
 * Corroboration threshold on `completion_confidence`.
 *
 * The platform is precise about what this field means: it scores CALL-E's own
 * judgment that the task reached a clear end state, and explicitly not the
 * likelihood of a favourable business answer. A high score does not establish
 * that a person answered.
 *
 * So it is used here as corroboration, never as the authorisation itself. The
 * authorisation comes from `answered_by` and `decision` in the structured
 * result. A low score means CALL-E does not think the call reached a clear end
 * state, which is reason enough to withhold a production change and escalate.
 */
const MIN_COMPLETION_CONFIDENCE = 0.5;

export class CalleIncidentCommander {
  constructor(apiKey = null) {
    this.apiKey = null;
    this.client = null;
    this.isLiveMode = false;
    this.baseUrl = 'https://api.heycall-e.com';

    // Set when a backend is holding the key on our behalf.
    this.useProxy = false;
    this.proxyBaseUrl = '/api/calle';

    // Where CALL-E should post terminal call state. Null until the server says
    // it has a receiver, because an unreachable URL is worse than none: the
    // ladder would wait on a delivery that is never coming.
    this.webhookUrl = null;

    const envKey = (typeof process !== 'undefined' && process.env?.CALLE_API_KEY) || null;
    this.setApiKey(apiKey || envKey);
  }

  // ---------------------------------------------------------------------------
  // Input hygiene
  // ---------------------------------------------------------------------------

  /**
   * Strips quotes and any non printable-ASCII code points from a pasted key.
   * Browsers reject header values outside ISO-8859-1, and keys copied from
   * rich-text sources routinely carry smart quotes or zero-width characters.
   */
  sanitizeApiKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') return '';
    return rawKey
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
      .replace(/[^\x21-\x7E]/g, '')
      .trim();
  }

  /** Normalises a pasted phone number to E.164, the only format CALL-E accepts. */
  sanitizePhoneNumber(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return '';
    let cleaned = rawPhone
      .replace(/[‐-―−]/g, '-')
      .replace(/[^\d+]/g, '')
      .trim();
    if (!cleaned) return '';
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    return cleaned;
  }

  /**
   * Rejects numbers that cannot possibly place a call before spending a credit
   * on them. Also blocks the reserved +1555xxxxxxx range, which is the
   * placeholder people leave in by accident.
   */
  validatePhoneNumber(rawPhone) {
    // Letters are rejected rather than stripped. Silently dropping them would
    // dial a different number than the operator typed, and this system spends
    // money and wakes people up at night.
    if (typeof rawPhone === 'string' && /[a-z]/i.test(rawPhone)) {
      return { valid: false, phone: '', error: 'Phone number contains letters. Enter digits only, for example +14155552671.' };
    }

    const phone = this.sanitizePhoneNumber(rawPhone);
    if (!phone || phone === '+') {
      return { valid: false, phone, error: 'Enter a phone number in international format, starting with the country code.' };
    }
    const digits = phone.slice(1);
    if (!/^\d+$/.test(digits)) {
      return { valid: false, phone, error: 'Phone number may only contain digits after the leading plus sign.' };
    }
    if (digits.length < 8 || digits.length > 15) {
      return { valid: false, phone, error: 'A valid E.164 number has between 8 and 15 digits, for example +14155552671 or +919876543210.' };
    }
    if (/^1555\d{7}$/.test(digits)) {
      return { valid: false, phone, error: 'That is the reserved +1 555 placeholder range and cannot be dialled. Enter a real mobile number.' };
    }

    // Format is necessary but not sufficient. The platform documents that a
    // valid E.164 number can still be rejected with unsupported_region, so the
    // destination is resolved against published coverage before a credit is
    // committed rather than after the call fails.
    const coverage = resolveRegion(phone);
    if (!coverage.supported) {
      return { valid: false, phone, error: coverage.warning, region: null };
    }

    return { valid: true, phone, error: null, region: coverage.region, warning: coverage.warning };
  }

  // ---------------------------------------------------------------------------
  // Client lifecycle
  // ---------------------------------------------------------------------------

  initClient() {
    try {
      if (this.useProxy) {
        // The proxy holds the real key. The placeholder below is never used to
        // authenticate anything: the server replaces the Authorization header
        // before the request leaves the machine.
        this.client = new CalleClient({ apiKey: 'proxied', baseUrl: this.proxyBaseUrl });
        this.isLiveMode = true;
      } else if (this.apiKey) {
        this.client = new CalleClient({ apiKey: this.apiKey, baseUrl: this.baseUrl });
        this.isLiveMode = true;
      } else {
        this.client = null;
        this.isLiveMode = false;
      }
    } catch (err) {
      console.warn('CALL-E client initialisation failed:', err);
      this.client = null;
      this.isLiveMode = false;
    }
  }

  /**
   * Switches to server-proxied mode, where the key never reaches the browser.
   *
   * This is the path CALL-E's guidance asks for, and it takes precedence over
   * any key pasted into the page.
   */
  enableProxyMode(baseUrl = '/api/calle') {
    this.useProxy = true;
    // The SDK builds a Request from baseUrl and throws on a bare path, so the
    // proxy path is resolved against the page origin before it is handed over.
    this.proxyBaseUrl = absolutizeUrl(baseUrl);
    this.apiKey = null;
    this.initClient();
    return this.isLiveMode;
  }

  /**
   * Sets a direct API key. Server-side callers only.
   *
   * The browser app never calls this. Its key lives in the server environment
   * and reaches CALL-E through the proxy, so there is no key field in the page
   * and nothing to steal from it. This path exists for Node entry points such
   * as the verification script and the test suite, which are trusted contexts.
   */
  setApiKey(key) {
    // A server-held key wins. Never downgrade an established proxy.
    if (this.useProxy) return this.isLiveMode;

    if (key && typeof window !== 'undefined') {
      console.warn('CALL-E: refusing to hold an API key in browser code. Set CALLE_API_KEY on the server instead.');
      return this.isLiveMode;
    }

    const cleaned = this.sanitizeApiKey(key);
    if (cleaned && cleaned.length >= 8) {
      this.apiKey = cleaned;
      this.initClient();
    } else {
      this.apiKey = null;
      this.client = null;
      this.isLiveMode = false;
    }
    return this.isLiveMode;
  }

  /**
   * Registers the webhook receiver CALL-E should post terminal call state to.
   *
   * Only an absolute HTTPS URL is accepted, because that is what the platform
   * takes and because a relative path here would silently produce calls with no
   * delivery target at all. A local dev server has no public address, so this
   * stays unset there and the ladder keeps polling, which is the correct
   * behaviour rather than a degraded one.
   *
   * @returns {boolean} Whether a receiver is now registered.
   */
  setWebhookUrl(url) {
    this.webhookUrl = typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
    return Boolean(this.webhookUrl);
  }

  /** How the current live connection reaches CALL-E, for display and audit. */
  get connectionMode() {
    if (!this.isLiveMode) return 'simulation';
    return this.useProxy ? 'server-proxied' : 'server-direct';
  }

  // ---------------------------------------------------------------------------
  // Call construction
  // ---------------------------------------------------------------------------

  /**
   * Builds a durable idempotency key.
   *
   * The same incident escalating to the same contact must never dial twice
   * because of a retry, a double-clicked button, or a page reload. The key is
   * derived only from stable business identifiers, never from a timestamp.
   *
   * A requested callback is the one case where dialling the same person for the
   * same incident a second time is correct rather than a bug, because they asked
   * for it on the first call. That intent is carried in the key as an explicit
   * attempt number, so the second call is a different request and the first key
   * still protects against every accidental redial. An attempt number is never
   * derived from a clock: attempt 2 exists because an engineer asked for it, not
   * because time passed.
   *
   * @param {string} incidentId
   * @param {string} contactId
   * @param {number} [attempt] 1 for the first page, 2+ for a requested callback.
   */
  buildIdempotencyKey(incidentId, contactId, attempt = 1) {
    const base = `incident:${incidentId}:notify:${contactId}:v1`;
    return attempt > 1 ? `${base}:callback:${attempt}` : base;
  }

  /**
   * Writes the conversation brief.
   *
   * This is a two-way conversation, not a recorded announcement. CALL-E is given
   * the incident facts so it can answer follow-up questions the engineer asks,
   * and is told to hold the line until it has an explicit decision. It is also
   * told what it must never do: ask for credentials, or accept a decision from
   * anyone who is not the on-call engineer.
   */
  buildTaskPrompt(scenario, contact, escalation = {}) {
    const rca = scenario.rcaReport || {};

    // A rota entry may hold a person's name or just a role label. Asking "am I
    // speaking to Primary On-Call?" confuses whoever picks up, and a confused
    // answer classifies as not-the-named-engineer, which blocks the deploy even
    // though a real human authorised it. So the wording adapts to what we have.
    const named = isPersonName(contact.name);
    const addressee = named ? contact.name : `the ${contact.role}`;
    const identityAsk = named
      ? `Confirm you are speaking to ${contact.name} before giving any detail.`
      : `Ask whether you are speaking to the ${contact.role} before giving any detail. You were not given their name, so do not guess at one.`;

    const escalationNote = escalation.escalatedFrom
      ? `\nYou are calling because ${escalation.escalatedFrom} did not answer or could not decide. Say so at the start.`
      : '';

    // A callback was asked for by the person being called, so the second call
    // has to sound like the continuation it is. Opening with the same cold
    // script would read as a system that did not listen the first time, and the
    // engineer would have to establish context again with the clock running.
    const callbackNote = escalation.callbackMinutes > 0
      ? `\nThis is the callback you agreed. You spoke to this person about ${escalation.callbackMinutes} minute(s) ago about this same incident and they asked you to call back then rather than deciding on the spot. Open by reminding them of that, ask whether they have had a chance to look, then ask for the decision again. Do not repeat the full briefing unless they ask for it.`
      : '';

    const whoLine = named
      ? `Call ${contact.name}, the ${contact.role} on the rota, and hold a real two-way conversation.`
      : `Call the ${contact.role} on the rota and hold a real two-way conversation.`;

    return `You are CALL-E, the automated incident commander for an engineering on-call rota.
${whoLine}${escalationNote}${callbackNote}

OPENING
Say who you are and that this is an automated page for a live production incident.
${identityAsk}

THE INCIDENT
Service: ${scenario.service}
Severity: ${scenario.severity}
Error: ${scenario.errorCode}
Customer impact: ${scenario.impact}
Suspected root cause: ${rca.rootCause || 'under investigation'}
Fault class: ${rca.vulnerabilityClass || 'unclassified'}
Suspected commit: ${rca.offendingCommit || 'not yet attributed'}
Proposed remediation: ${rca.recommendedFix || 'a hotfix is being prepared'}
Automated verification: the proposed hotfix has been applied in an isolated sandbox and the regression suite passes there. It has NOT been applied to production.

ANSWER THEIR QUESTIONS
The engineer will interrupt and ask things. Answer from the facts above, conversationally and briefly.
If they ask something you were not told, say plainly that you do not have that detail rather than inventing it.

GET A DECISION
You must leave the call with one clear authorised action. Ask directly:
"Do you want me to deploy the hotfix now, hold it for your review, roll back the last release, or wake the backup on-call?"
If they are unsure, offer to call back and ask how many minutes they need.
Repeat their chosen action back to them and get confirmation before you hang up.

RULES
Never ask for passwords, tokens, one-time codes, or any credential.
Establish who you are speaking to before giving any incident detail.
If a voicemail greeting, answering machine, or automated menu picks up, do not leave incident detail. End the call and record that voicemail answered.
If a person answers but is not ${addressee}, do not give incident detail and do not accept a decision from them. Ask them to have ${addressee} call back, then end the call.
Only ${addressee} can authorise a production change on this call.
Keep the whole call under three minutes.`;
  }

  // ---------------------------------------------------------------------------
  // Placing the call
  // ---------------------------------------------------------------------------

  /**
   * Places one outbound incident call and returns a handle to track it.
   *
   * Returns { mode } of either 'live' or 'simulated'. Simulated mode never
   * claims to have called anyone; the UI is expected to label it as such.
   */
  async placeIncidentCall({ scenario, contact, incidentId, escalatedFrom = null, attempt = 1, callbackMinutes = 0 }) {
    const check = this.validatePhoneNumber(contact.phone);
    if (!check.valid) {
      return { mode: 'error', error: check.error, contact };
    }

    const task = this.buildTaskPrompt(scenario, contact, { escalatedFrom, callbackMinutes });
    const idempotencyKey = this.buildIdempotencyKey(incidentId, contact.id, attempt);

    if (!this.isLiveMode || !this.client) {
      return {
        mode: 'simulated',
        callId: null,
        contact,
        task,
        idempotencyKey,
        startedAt: new Date().toISOString()
      };
    }

    try {
      const call = await this.client.calls.create(
        {
          task,
          recipient: {
            phone: check.phone,
            // Resolved from published coverage rather than left blank, so
            // CALL-E routes on the destination it actually supports.
            region: contact.region || check.region?.code,
            locale: contact.locale || check.region?.locale
          },
          recipientResultSchema: INCIDENT_DECISION_SCHEMA,
          // Set only when a receiver is configured, so a checkout with no
          // webhook endpoint does not ask CALL-E to post terminal state into
          // the void and then wait on a delivery that cannot arrive.
          ...(this.webhookUrl ? { webhookUrl: this.webhookUrl } : {}),
          metadata: {
            incident_id: incidentId,
            service: scenario.service,
            severity: scenario.severity,
            error_code: scenario.errorCode,
            contact_id: contact.id,
            contact_role: contact.role,
            escalated_from: escalatedFrom || 'none',
            // Carried so the webhook receiver can tell a first page from a
            // callback without holding state of its own.
            attempt: String(attempt)
          }
        },
        { idempotencyKey }
      );

      return {
        mode: 'live',
        callId: call.id,
        status: call.status,
        contact,
        task,
        idempotencyKey,
        attempt,
        startedAt: call.createdAt
      };
    } catch (err) {
      return {
        mode: 'error',
        error: this.describeApiError(err),
        contact,
        task,
        idempotencyKey
      };
    }
  }

  /**
   * Turns an SDK error into something an engineer can act on.
   *
   * CALL-E publishes a stable set of error codes and the SDK preserves them, so
   * this branches on the code rather than the HTTP status. Status alone
   * collapses distinct problems: a bad key and a region that is simply not
   * covered both arrive as a 4xx, and they need completely different fixes.
   */
  describeApiError(err) {
    if (!err) return 'Unknown CALL-E error.';

    switch (err.code) {
      case 'unauthorized':
        return 'CALL-E rejected the API key. Check it was copied in full from the dashboard and has not expired.';
      case 'forbidden':
        return 'The API key is valid but not allowed to use this project, region, or capability.';
      case 'insufficient_balance':
        return 'This CALL-E project has no remaining balance, so no further calls can be started until billing is resolved.';
      case 'unsupported_region':
        return 'CALL-E does not currently cover this destination. Correct phone formatting alone does not resolve a coverage error.';
      case 'unsupported_language':
        return 'CALL-E does not support the requested language for this destination.';
      case 'invalid_phone':
      case 'invalid_recipient':
        return 'CALL-E rejected the phone number. Check it is a real number in full international format.';
      case 'no_recipients':
        return 'No recipient reached CALL-E. This is a bug in how the call was built.';
      case 'recipient_blocked':
        return 'This number is blocked from receiving calls on this project.';
      case 'policy_violation':
        return 'CALL-E refused the call task on policy grounds. Review the wording of the incident brief.';
      case 'recipient_result_schema_invalid':
      case 'result_schema_invalid':
        return 'CALL-E rejected the decision schema. Supported features are type, properties, required, enum, nested objects, simple array items, description, and additionalProperties false.';
      case 'idempotency_conflict':
        return 'This rung was already dialled for this incident with different call details. Reset the incident to page the rota again.';
      case 'rate_limit_exceeded':
        return 'CALL-E rate limit reached. Wait a few seconds and dial again.';
      case 'account_concurrency_exceeded':
        // Distinct from a rate limit, and the distinction is the whole reason
        // for branching on codes rather than on status. Both arrive as 429, but
        // a rate limit clears on its own in seconds while this one waits on a
        // specific call that is still running, and on a shared line that call
        // may not be yours. Telling an engineer to "wait a few seconds and dial
        // again" during an incident would be wrong twice over.
        //
        // A sequential ladder is compatible with a concurrency of one, because
        // it never dials two rungs at once. What it cannot survive is another
        // task holding the only line, so the message says where to look.
        return 'The CALL-E account is at its concurrent-call limit, so this rung could not be dialled. A shared line allows one call at a time across the API, MCP, and the dashboard. Wait for the active call to finish, or raise the limit with identity verification and a dedicated number.';
      case 'provider_unavailable':
        return 'CALL-E\'s telephony provider is temporarily unavailable. Retry shortly.';
      case 'not_found':
        return 'CALL-E could not find that call task.';
      case 'internal_error':
        return 'CALL-E reported an internal error. Retry, and keep the call id for support.';
      default:
        break;
    }

    const status = err.status || err.statusCode;
    if (status === 401 || status === 403) return 'CALL-E rejected the API key.';
    // A 429 with no recognised code could be either a rate limit or a
    // concurrency limit, and they need different responses, so this says what is
    // actually known rather than guessing at one of them.
    if (status === 429) return `CALL-E refused the call for a limit on this account. ${err.message || 'No further detail was given.'}`;
    return err.message || 'CALL-E request failed.';
  }

  // ---------------------------------------------------------------------------
  // Tracking the call
  // ---------------------------------------------------------------------------

  /**
   * Reads current call state and flattens it into what the incident UI needs.
   * Returns null when there is nothing live to poll.
   */
  async pollCall(callId, contact = null) {
    if (!this.isLiveMode || !this.client || !callId) return null;

    try {
      const call = await this.client.calls.get(callId);
      const recipient = call.recipients?.[0] || null;
      const attempt = recipient?.attempts?.[recipient.attempts.length - 1] || null;

      return {
        callId: call.id,
        status: call.status,
        isTerminal: TERMINAL_CALL_STATUSES.has(call.status),
        recipientStatus: recipient?.status || 'pending',
        attemptStatus: attempt?.status || 'queued',
        phone: attempt?.phone || recipient?.phones?.[0] || null,
        summary: call.summary || recipient?.summary || attempt?.summary || null,
        taskCompleted: call.taskCompleted,
        completionConfidence: call.completionConfidence,
        evidence: call.evidence || [],
        structuredResult: recipient?.structuredResult ?? call.structuredResult ?? null,
        // Echoed back by CALL-E on the call it was set on. The webhook receiver
        // reads the incident correlation ids from here rather than from the
        // delivery body, because this copy came back over an authenticated read.
        metadata: call.metadata || {},
        failureCode: call.failureCode || attempt?.failureCode || null,
        failureMessage: call.failureMessage || attempt?.failureMessage || null,
        transcript: (attempt?.transcriptTurns || []).map((turn) => ({
          speaker: turn.speaker === 'bot' ? 'CALL-E' : turn.speaker === 'user' ? (contact?.name || 'Engineer') : 'Unknown',
          // Recorded here, where the API's own bot/user values are still
          // visible. A display name cannot carry this: the recipient's name is
          // operator-supplied and could be anything, including "CALL-E".
          fromRecipient: turn.speaker === 'user',
          text: turn.text,
          offsetSeconds: turn.offset_seconds ?? null
        })),
        createdAt: call.createdAt,
        completedAt: call.completedAt
      };
    } catch (err) {
      return {
        callId,
        status: 'unknown',
        isTerminal: false,
        error: this.describeApiError(err)
      };
    }
  }

  /**
   * Pulls the developer event stream for a call so the incident timeline shows
   * what CALL-E actually did, rather than a spinner.
   */
  async listCallEvents(callId, cursor = undefined) {
    if (!this.isLiveMode || !this.client || !callId) {
      return { events: [], nextCursor: null };
    }
    try {
      const list = await this.client.calls.listEvents(callId, cursor ? { cursor, limit: 50 } : { limit: 50 });
      return { events: list.data || [], nextCursor: list.nextCursor || null };
    } catch (err) {
      return { events: [], nextCursor: null, error: this.describeApiError(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // Decision interpretation
  // ---------------------------------------------------------------------------

  /**
   * Converts a finished call into an incident decision the pipeline can act on.
   *
   * Authorisation comes from the business answer: the named engineer must have
   * been on the line and must have chosen an action that authorises a change.
   * CALL-E's task-completion judgment and its confidence are corroboration that
   * can withhold that authorisation but can never supply it. Anything short of
   * a clear authorisation escalates, because acting on a misheard "yeah" during
   * a SEV-1 is worse than waking one more person up.
   */
  interpretDecision(snapshot) {
    if (!snapshot) {
      return {
        decision: 'no_decision',
        answeredBy: 'unknown',
        reachedEngineer: false,
        authorised: false,
        shouldEscalate: true,
        requestedCallback: false,
        reason: 'No call state available.',
        confidence: null
      };
    }

    if (snapshot.failureCode) {
      // failure_code is documented as diagnostic context with no published
      // enum, and the platform warns against inferring a decline or a no-answer
      // from it. So the raw value is preserved for support and is never read as
      // an outcome.
      //
      // A failed call can still carry a structured result, and that result is a
      // different source of evidence: CALL-E's own classification of where the
      // call ended, extracted against the schema rather than inferred from a
      // status string. A real no-answer comes back exactly this way. Reading it
      // is what lets the post-mortem say "nobody answered" instead of "an
      // unidentified answerer", so it is read here when it is schema-valid.
      //
      // Nothing below can authorise anything. A call that failed did not
      // produce a decision, so the decision stays no_decision and the rung
      // escalates whatever the endpoint turned out to be.
      return {
        decision: 'no_decision',
        answeredBy: readAnsweredBy(snapshot.structuredResult),
        reachedEngineer: false,
        authorised: false,
        shouldEscalate: true,
        requestedCallback: false,
        reason: snapshot.failureMessage
          ? `The call did not complete. CALL-E reported: ${snapshot.failureMessage}`
          : 'The call did not complete, and CALL-E gave no reason that establishes why.',
        confidence: null,
        failureCode: snapshot.failureCode,
        failureMessage: snapshot.failureMessage || null
      };
    }

    const result = snapshot.structuredResult || {};
    const decision = typeof result.decision === 'string' ? result.decision : 'no_decision';
    const answeredBy = readAnsweredBy(result);

    // Only the person we asked for can authorise a production change. A
    // colleague who picked up their phone, a voicemail greeting, or an
    // ambiguous answer all fail closed and climb the ladder instead.
    const reachedEngineer = answeredBy === 'named_engineer';

    const confidence = snapshot.completionConfidence?.score ?? null;
    const confidenceOk = confidence === null ? true : confidence >= MIN_COMPLETION_CONFIDENCE;

    // The business answer is the gate. `task_completed` and its confidence are
    // corroboration only: the platform states that a true value or a high score
    // does not establish that a person answered, so neither can stand in for
    // `answered_by`. They can still withhold an authorisation, never grant one.
    const taskReachedEndState = snapshot.taskCompleted !== false;

    const authorised =
      reachedEngineer
      && confidenceOk
      && taskReachedEndState
      && AUTHORISING_DECISIONS.has(decision);

    const callbackMinutes = Number.isInteger(result.callback_minutes) ? result.callback_minutes : null;

    // An engineer who asks for ten minutes has not failed to decide. They have
    // decided to look before deciding, which is a normal and often correct
    // response to being woken at 3am and asked to authorise a change to
    // production. Escalating past them would wake the backup to ask a question
    // the primary is already awake and working on, and it would teach the rota
    // that asking for time gets your colleague called.
    //
    // It requires the same corroboration as an authorisation, for a plain
    // reason: this is the branch that stops the ladder, and a misheard "call me
    // back" would leave a live incident sitting on a timer with nobody else
    // told. When the extraction is weak, waking the next person is the safer
    // reading of an unclear call.
    const requestedCallback =
      reachedEngineer
      && confidenceOk
      && taskReachedEndState
      && !authorised
      && decision === 'no_decision'
      && callbackMinutes !== null
      && callbackMinutes > 0;

    const shouldEscalate =
      !requestedCallback && (
        !reachedEngineer ||
        decision === 'escalate_to_backup' ||
        decision === 'no_decision' ||
        !confidenceOk ||
        !taskReachedEndState
      );

    return {
      decision,
      answeredBy,
      reachedEngineer,
      authorised,
      shouldEscalate,
      confidence,
      confidenceLabel: snapshot.completionConfidence?.label ?? null,
      lowConfidence: !confidenceOk,
      taskCompleted: snapshot.taskCompleted ?? null,
      requestedCallback,
      reason: result.reason || snapshot.summary || 'No reason recorded.',
      acknowledgedSeverity: result.acknowledged_severity === 'yes',
      callbackMinutes,
      questionsAsked: Array.isArray(result.questions_asked) ? result.questions_asked : [],
      evidence: snapshot.evidence || []
    };
  }

  /** Explains who picked up, for the rung badge and the post-mortem. */
  static describeAnswerer(answeredBy) {
    switch (answeredBy) {
      case 'named_engineer': return 'the named engineer';
      case 'different_person': return 'someone other than the named engineer';
      case 'voicemail_or_ivr': return 'voicemail or an automated menu';
      case 'no_answer': return 'nobody';
      default: return 'an unidentified answerer';
    }
  }

  /** Human-readable label for a decision code, used in the UI and the RCA export. */
  static describeDecision(decision) {
    switch (decision) {
      case 'deploy_hotfix': return 'Deploy the verified hotfix now';
      case 'hold_for_review': return 'Hold the hotfix for human review';
      case 'rollback_release': return 'Roll back the last release';
      case 'escalate_to_backup': return 'Escalate to the backup on-call';
      default: return 'No decision recorded';
    }
  }
}

/**
 * Decides whether a rota entry holds a person's name or a role label.
 *
 * Rota fields get filled with things like "Primary On-Call" or "SRE rota" as
 * often as with an actual name. Reading one of those out as if it were a person
 * makes the opening line nonsense and poisons the identity check that gates the
 * whole authorisation, so it is worth detecting.
 */
const ROLE_LABEL_WORDS = /\b(on[- ]?call|oncall|primary|backup|secondary|manager|engineer|rota|duty|team|lead|sre|ops|support|admin|escalation|tier|shift|group|rotation)\b/i;

const NAME_WORD = /^[\p{L}][\p{L}'’.-]*$/u;

export function isPersonName(value) {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  if (name.length < 2) return false;

  // A label such as "Primary On-Call" or "SRE rota" must not be read out as
  // though it were a person.
  if (ROLE_LABEL_WORDS.test(name)) return false;

  // A person's name is a small number of alphabetic words.
  const words = name.split(/\s+/);
  if (words.length > 4) return false;
  return words.every((w) => NAME_WORD.test(w));
}

/**
 * Turns a same-origin path into an absolute URL.
 *
 * Left as-is when already absolute, or when there is no page origin to resolve
 * against, which is the case under the Node test runner.
 */
function absolutizeUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== 'undefined' && window.location?.origin;
  return origin ? `${origin}${url.startsWith('/') ? '' : '/'}${url}` : url;
}

export const calleService = new CalleIncidentCommander();

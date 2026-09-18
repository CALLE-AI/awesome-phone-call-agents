const { CallProvider } = require('./call-provider');

// Verified 2026-09-13 against docs.heycall-e.com. The endpoint this used to target
// (seleven-mcp-sg.airudder.com, an MCP host from SPEC.md's original planning) 401s a
// static bearer key — it wants OAuth — and was never given a JSON-RPC envelope anyway.
// The documented static-API-key integration is this plain REST API instead.
const DEFAULT_BASE_URL = 'https://api.heycall-e.com';

// A real call runs for as long as an actual phone conversation does; polling for the
// terminal state (not expecting it synchronously in the create response) is required —
// see "Call status" at docs.heycall-e.com/calls. The timeout is generous because
// giving up early doesn't stop the call (CALL-E has no client cancel operation) — it
// only throws away the outcome of a call that was placed and billed anyway.
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 600000;
// Bounds one HTTP request, so a hung socket can't outlive the poll deadline.
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

// Strict E.164: a leading +, a non-zero first digit, up to 15 digits total, nothing else —
// what CALL-E's API actually requires (a punctuated number like "+1-555-0100" 400s there;
// see docs/real-call.md). Checked separately from the ASCII guard below so a homoglyph or
// RTL-override digit fails on "not ASCII" rather than a confusing "not E.164".
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

// Refuses to dial a destination that isn't a clean, explicit phone number — guards the
// one field this module hands to a paid external API against injection, corruption, or a
// unicode homoglyph, regardless of how it reached the task.
function normalizeAndValidatePhone(rawPhone) {
  if (typeof rawPhone !== 'string' || rawPhone.length === 0) {
    throw new Error('Supplier phone must be a non-empty string; refusing to dial.');
  }
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7F]*$/.test(rawPhone)) {
    throw new Error(`Supplier phone "${rawPhone}" contains non-ASCII characters; refusing to dial.`);
  }
  const normalized = rawPhone.replace(/[\s().-]/g, '');
  if (!E164_PATTERN.test(normalized)) {
    throw new Error(`Supplier phone "${rawPhone}" is not a valid E.164 number; refusing to dial.`);
  }
  return normalized;
}

// CALL-E extracts this from the call transcript/evidence and validates it strictly
// (additionalProperties: false) before returning it — see "Structured results" at
// docs.heycall-e.com/calls. Field names match this app's own outcome shape so
// parseCallEResponse below needs no translation.
const RESULT_SCHEMA = {
  type: 'object',
  required: ['outcome', 'summary', 'next_action'],
  properties: {
    outcome: {
      type: 'string',
      enum: ['quoted', 'no_answer', 'declined', 'voicemail', 'failed'],
      description:
        'Use quoted when unit price, lead time, and MOQ were obtained. Use no_answer if ' +
        'nobody picked up. Use declined if the supplier refused to quote. Use voicemail if ' +
        'it went to voicemail. Use failed for any other failure.'
    },
    summary: {
      type: 'string',
      description:
        'A concise summary of what the supplier said, including price, lead time, and ' +
        'minimum order quantity if given.'
    },
    next_action: {
      type: 'string',
      enum: ['review_quote', 'retry_call', 'no_action'],
      description:
        'Use review_quote when a quote was obtained, retry_call if the call failed to ' +
        'reach anyone, no_action otherwise.'
    }
  },
  additionalProperties: false
};

function buildCallRequest(task, scenario) {
  const supplier = (task.suppliers && task.suppliers[0]) || null;
  if (!supplier) {
    throw new Error('Task has no supplier to call.');
  }
  const goal = (task.plan && task.plan.goal) || `Get a quote for ${task.sku} (qty ${task.quantity})`;
  return {
    task:
      `Call ${supplier.name} on behalf of a procurement buyer. ${goal} ` +
      `Introduce yourself, request unit price, lead time, and minimum order quantity for ` +
      `${task.sku} (qty ${task.quantity}), thank them, and end the call.`,
    // Explicit recipient rather than leaving CALL-E to infer the number out of the
    // task text — the docs allow either, and inference is the avoidable risk here.
    recipients: [{ phones: [normalizeAndValidatePhone(supplier.phone)] }],
    result_schema: RESULT_SCHEMA,
    metadata: { task_id: task.id, supplier_name: supplier.name, scenario: scenario || undefined }
  };
}

// Only `completed` means the call ran to the end; `failed`/`canceled` carry no usable
// business outcome even when an extraction happens to be attached, so the top-level
// status decides first and the extraction is read only under it. CALL-E returns
// structured_result null when it cannot validate an extraction against result_schema —
// on a completed call that is "nothing to report", not a reason to dial again.
function parseCallEResponse(raw) {
  const result = raw.structured_result;
  if (raw.status !== 'completed') {
    return {
      outcome: 'failed',
      summary: (result && result.summary) || `Call ${raw.status || 'unknown'}; no outcome recorded.`,
      next_action: 'retry_call'
    };
  }
  if (!result) {
    return {
      outcome: 'failed',
      summary: 'Call completed but CALL-E could not extract a schema-valid result from it.',
      next_action: 'no_action'
    };
  }
  return { outcome: result.outcome, summary: result.summary, next_action: result.next_action };
}

function abortError() {
  const err = new Error('Call aborted');
  err.name = 'AbortError';
  return err;
}

// Removes its own abort listener on every exit path. `{ once: true }` alone only
// detaches when abort actually fires, so a listener per poll accumulates across a call
// long enough to matter and Node starts printing MaxListenersExceededWarning — into
// whatever terminal is on screen at the time.
function sleepUnlessAborted(ms, signal) {
  if (signal && signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Real SDK/API path. Reads credentials from process.env only as constructor defaults
// (evaluated at construction, never at module load), and only ever talks to the
// network through an injectable fetchImpl — that's what makes it unit-testable against
// fixtures with zero network access. Never called by any test with the real fetchImpl;
// running an actual call is the owner's job in #9 (see README.md).
//
// One asymmetry with FakeCallProvider worth knowing before trusting `cancel_call`
// against this provider: aborting stops *this process* waiting, and nothing more.
// "The Calls API does not expose an operation for clients to cancel a call after it
// has been created" (docs.heycall-e.com/calls), so a real call already in flight rings
// and bills to completion regardless. README.md's "Cancelling and rolling back" says
// so too — the task is marked cancelled, the phone call is not.
class CallEProvider extends CallProvider {
  constructor({
    apiKey = process.env.CALLE_API_KEY,
    baseUrl = process.env.CALLE_BASE_URL || DEFAULT_BASE_URL,
    fetchImpl = (...args) => fetch(...args),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  } = {}) {
    super();
    // Pinned to https:// so the real API key (read from CALLE_API_KEY, never from a
    // request) can never be sent to a plaintext or otherwise-unpinned origin — baseUrl
    // itself is only ever operator-configured (env), never a per-call argument.
    if (!/^https:\/\//i.test(baseUrl)) {
      throw new Error(
        `CALLE_BASE_URL must be an https:// origin (got "${baseUrl}"); refusing to send ` +
        'credentials to an unpinned or insecure origin.'
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
    this.pollTimeoutMs = pollTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  // The Calls API "does not expose an operation for clients to cancel a call after it
  // has been created" (docs.heycall-e.com/calls) — aborting here only stops this process
  // waiting, never the phone call itself.
  get cancelIsAuthoritative() {
    return false;
  }

  // The caller's signal (cancel_call) and a per-request timeout, as one signal.
  _requestSignal(signal) {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  async placeCall(task, { onStatusChange, signal, scenario } = {}) {
    if (!this.apiKey) {
      throw new Error(
        'CALLE_API_KEY is not set; see README.md for the real-provider env vars. Refusing to dial.'
      );
    }

    if (onStatusChange) {
      onStatusChange('dialing', new Date().toISOString());
    }

    const createResponse = await this.fetchImpl(`${this.baseUrl}/v1/calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        // Stable for one approval, different after the next one: a lost response can
        // be re-sent without dialing twice, while re-planning and re-approving a task
        // (which is how this app asks for a second call) deliberately gets a new key.
        'Idempotency-Key': `${task.id || 'task'}:${task.approvedAt || 'unapproved'}`
      },
      body: JSON.stringify(buildCallRequest(task, scenario)),
      signal: this._requestSignal(signal)
    });

    if (!createResponse.ok) {
      throw new Error(`CALL-E request failed with status ${createResponse.status}`);
    }

    const created = await createResponse.json();
    if (!created || !created.id) {
      // The call may already be dialing at this point, so say plainly that the id is
      // what is missing rather than letting a /v1/calls/undefined 404 blame polling.
      throw new Error(
        `CALL-E accepted the call but returned no "id" to poll (got keys: ${Object.keys(created || {}).join(', ') || 'none'}).`
      );
    }
    const terminal = await this._pollUntilTerminal(created.id, signal, onStatusChange);

    if (onStatusChange) {
      onStatusChange('done', new Date().toISOString());
    }

    return parseCallEResponse(terminal);
  }

  async _pollUntilTerminal(callId, signal, onStatusChange) {
    const deadline = Date.now() + this.pollTimeoutMs;
    let announcedConnected = false;

    for (;;) {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/calls/${callId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: this._requestSignal(signal)
      });
      if (!response.ok) {
        throw new Error(`CALL-E status check failed with status ${response.status}`);
      }

      const call = await response.json();

      if (!announcedConnected && call.status === 'in_progress' && onStatusChange) {
        onStatusChange('connected', new Date().toISOString());
        announcedConnected = true;
      }

      if (TERMINAL_STATUSES.has(call.status)) {
        return call;
      }
      if (Date.now() > deadline) {
        throw new Error(`CALL-E call ${callId} did not reach a terminal state within ${this.pollTimeoutMs}ms`);
      }

      await sleepUnlessAborted(this.pollIntervalMs, signal);
    }
  }
}

module.exports = { CallEProvider, parseCallEResponse, buildCallRequest, DEFAULT_BASE_URL, RESULT_SCHEMA };

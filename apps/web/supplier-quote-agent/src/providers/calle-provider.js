const { CallProvider } = require('./call-provider');
const { maskPhone } = require('../mask');
const { isFictionalNumber } = require('../fictional-numbers');

// Verified 2026-09-13 against docs.heycall-e.com. The endpoint this used to target
// (seleven-mcp-sg.airudder.com, an MCP host from SPEC.md's original planning) 401s a
// static bearer key — it wants OAuth — and was never given a JSON-RPC envelope anyway.
// The documented static-API-key integration is this plain REST API instead.
const DEFAULT_BASE_URL = 'https://api.heycall-e.com';

// The only origin CALLE_API_KEY is ever sent to. Compared against the PARSED origin of the
// configured base URL, never a string prefix: "https://api.heycall-e.com.evil.example"
// starts with the right characters and is a different host.
const APPROVED_API_ORIGINS = Object.freeze(['https://api.heycall-e.com']);

// A call id comes back from the API and becomes a path segment of the next request. The
// origin is fixed regardless (URLs are built against the pinned origin), but a plain token
// also keeps it from turning into a dot-segment or anything else surprising.
const CALL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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

// NANP (+1) numbers are exactly a 3-digit area code and a 7-digit number, and neither the
// area code nor the exchange may start with 0 or 1. "+1-555-0100" — this app's own seed,
// written without an area code — normalizes to "+15550100" and fails here.
const NANP_PATTERN = /^\+1([2-9]\d{2})([2-9]\d{2})\d{4}$/;
const NANP_SERVICE_CODE = /^[2-9]11$/;

// Outside NANP the operator allowlist (CALLE_ALLOWED_DESTINATIONS) is the real completeness
// check — no per-country numbering data ships with this app — so this is only a floor that
// rejects anything visibly truncated.
const MIN_INTERNATIONAL_DIGITS = 8;

// Turns a raw supplier number into the strict E.164 string CALL-E's API requires, or
// refuses. Guards the one value this module hands to a paid external API against
// injection, truncation, a unicode homoglyph, or a service code, however it reached the
// task. Never echoes the raw number back: an error message is display text too.
function parseDestination(rawPhone) {
  if (typeof rawPhone !== 'string' || rawPhone.trim().length === 0) {
    throw new Error('Supplier phone must be a non-empty string; refusing to dial.');
  }
  const shown = maskPhone(rawPhone);
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7F]*$/.test(rawPhone)) {
    throw new Error(`Supplier phone ${shown} contains non-ASCII characters; refusing to dial.`);
  }
  // A UK-style "(0)" trunk marker is dropped, as a person dialling would; left in, it
  // turns "+44 (0)20 …" into a different, invalid number.
  const normalized = rawPhone.replace(/\(0\)/g, '').replace(/[\s().-]/g, '');
  if (!E164_PATTERN.test(normalized)) {
    throw new Error(`Supplier phone ${shown} is not a valid E.164 number; refusing to dial.`);
  }
  // Only for +44: a national trunk 0 after the country code is never part of a UK number
  // in international form. (Not a general rule — Italy's +39 0… is valid.)
  if (normalized.startsWith('+440')) {
    throw new Error(
      `Supplier phone ${shown} keeps the UK trunk 0 after +44 (write +44 20…, not +44 020…); refusing to dial.`
    );
  }
  if (normalized.startsWith('+1')) {
    const nanp = NANP_PATTERN.exec(normalized);
    if (!nanp) {
      throw new Error(
        `Supplier phone ${shown} is not a complete North American number (+1, a 3-digit area ` +
        'code, then 7 digits); refusing to dial.'
      );
    }
    if (NANP_SERVICE_CODE.test(nanp[1]) || NANP_SERVICE_CODE.test(nanp[2])) {
      throw new Error(`Supplier phone ${shown} uses an N11 service code, not a subscriber line; refusing to dial.`);
    }
  } else if (normalized.length - 1 < MIN_INTERNATIONAL_DIGITS) {
    throw new Error(`Supplier phone ${shown} is too short to be a complete international number; refusing to dial.`);
  }
  return normalized;
}

// CALLE_ALLOWED_DESTINATIONS is a comma-separated list; blank entries (a trailing comma, an
// empty .env line) are dropped rather than failing, and unset means "nothing authorized".
function parseAllowlistEnv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Every entry is held to the same rules as a destination, at construction — a typo or a
// sample number in the allowlist is a loud misconfiguration, never silently dropped.
function buildAllowlist(entries, isFictionalDestination) {
  if (!Array.isArray(entries)) {
    throw new Error('allowedDestinations must be an array of E.164 numbers.');
  }
  const allowed = new Set();
  entries.forEach((entry, index) => {
    let normalized;
    try {
      normalized = parseDestination(entry);
    } catch (err) {
      throw new Error(`CALLE_ALLOWED_DESTINATIONS entry #${index + 1}: ${err.message}`);
    }
    if (isFictionalDestination(normalized)) {
      throw new Error(
        `CALLE_ALLOWED_DESTINATIONS entry #${index + 1} (${maskPhone(normalized)}) is a number ` +
        'reserved for fiction; it can never be a live destination.'
      );
    }
    allowed.add(normalized);
  });
  return allowed;
}

// Parses the configured base URL and returns its origin, or refuses. The error never
// repeats the configured value: it can carry credentials (https://user:pass@...), and this
// message reaches the activity log and the dashboard.
function pinApiOrigin(baseUrl) {
  const refuse = (why) => new Error(
    `CALLE_BASE_URL ${why}; the CALL-E API origin is pinned to ` +
    `${APPROVED_API_ORIGINS.join(', ')} and credentials are sent nowhere else.`
  );
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw refuse('is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw refuse('must be an https origin');
  }
  if (url.username || url.password) {
    throw refuse('must not carry credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw refuse('must be a bare origin, with no path, query, or fragment');
  }
  if (!APPROVED_API_ORIGINS.includes(url.origin)) {
    throw refuse('is not an approved CALL-E origin');
  }
  return url.origin;
}

// undici (Node's fetch) rejects a 3xx under redirect: 'error' with a bare TypeError("fetch
// failed") whose cause says why — without this, the operator only ever sees "fetch failed".
function isRedirectRefusal(err) {
  return Boolean(err && err.name === 'TypeError' && err.cause && /redirect/i.test(String(err.cause.message)));
}

// A header value may only hold visible ASCII. A key that picked up a newline or a space
// (node --env-file turns "\n" inside double quotes into a real newline) would make fetch
// throw an error that quotes the whole Authorization header, key included.
const API_KEY_PATTERN = /^[\x21-\x7E]+$/;
function assertUsableApiKey(apiKey) {
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new Error(
      'CALLE_API_KEY contains whitespace or control characters (check its quoting in .env); ' +
      'refusing to send it.'
    );
  }
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
      // Summaries are masked for phone numbers by shape (src/mask.js): a bare run of 7+
      // digits is hidden. Separators and currency symbols keep the quote's own figures
      // readable, and a phone number the supplier reads out is hidden either way.
      description:
        'A concise summary of what the supplier said, including price, lead time, and ' +
        'minimum order quantity if given. Write every price with its currency symbol ' +
        '(e.g. $12.50) and every number of 1,000 or more with thousands separators ' +
        '(e.g. 2,500,000 units).'
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

// `destination` is the already-authorized E.164 string from
// CallEProvider#_authorizedDestination — this function never decides who gets dialled.
function buildCallRequest(task, scenario, destination) {
  const supplier = task.suppliers[0];
  const goal = (task.plan && task.plan.goal) || `Get a quote for ${task.sku} (qty ${task.quantity})`;
  return {
    task:
      `Call ${supplier.name} on behalf of a procurement buyer. ${goal} ` +
      `Introduce yourself, request unit price, lead time, and minimum order quantity for ` +
      `${task.sku} (qty ${task.quantity}), thank them, and end the call.`,
    // Explicit recipient rather than leaving CALL-E to infer the number out of the
    // task text — the docs allow either, and inference is the avoidable risk here.
    recipients: [{ phones: [destination] }],
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
// fixtures with zero network access. The only test that hands it the real fetch points it
// at a loopback server answering 302, never at CALL-E; running an actual call is the
// owner's job in #9 (see README.md).
//
// One asymmetry with FakeCallProvider worth knowing before trusting `cancel_call`
// against this provider: aborting stops *this process* waiting, and nothing more.
// "The Calls API does not expose an operation for clients to cancel a call after it
// has been created" (docs.heycall-e.com/calls), so a real call already in flight rings
// and bills to completion regardless. README.md's "Cancelling and rolling back" says
// so too — the task is marked cancel_requested, and the phone call is not stopped.
class CallEProvider extends CallProvider {
  // Every option is operator/test configuration; invoke.js constructs this provider with no
  // options at all, so nothing in a request can reach the origin, the allowlist, or the
  // fictional-number policy. `isFictionalDestination` exists only so tests can accept one
  // reserved-for-fiction fixture — no real number ever appears in this repo to test with.
  constructor({
    apiKey = process.env.CALLE_API_KEY,
    baseUrl = process.env.CALLE_BASE_URL || DEFAULT_BASE_URL,
    allowedDestinations = parseAllowlistEnv(process.env.CALLE_ALLOWED_DESTINATIONS),
    isFictionalDestination = isFictionalNumber,
    fetchImpl = (...args) => fetch(...args),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  } = {}) {
    super();
    if (apiKey) {
      assertUsableApiKey(apiKey);
    }
    this.origin = pinApiOrigin(baseUrl);
    this.allowedDestinations = buildAllowlist(allowedDestinations, isFictionalDestination);
    this.isFictionalDestination = isFictionalDestination;
    this.apiKey = apiKey;
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

  // Resolved against the pinned origin, so no path or id can change which host receives
  // the Authorization header.
  _apiUrl(path) {
    return new URL(path, this.origin).href;
  }

  // Every request carrying CALLE_API_KEY goes through here. redirect: 'error' makes fetch
  // reject any 3xx instead of replaying the Authorization header to wherever it points.
  // A failure before any response is reported by its cause code only: fetch's own messages
  // can quote the request's headers, and this message reaches the activity log.
  async _fetch(path, init) {
    let response;
    try {
      response = await this.fetchImpl(this._apiUrl(path), { ...init, redirect: 'error' });
    } catch (err) {
      if (isRedirectRefusal(err)) {
        throw new Error('CALL-E responded with a redirect; refusing to follow it with credentials attached.');
      }
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw err;
      }
      const code = (err && err.cause && err.cause.code) || (err && err.name) || 'unknown error';
      throw new Error(`CALL-E request failed before a response (${code}).`);
    }
    this._assertPinnedResponse(response);
    return response;
  }

  // Belt and braces for a fetchImpl that ignores `redirect` (a wrapper, a polyfill): a
  // response that says it was redirected, or that came from anywhere but the pinned origin,
  // is refused before its body is read.
  _assertPinnedResponse(response) {
    if (response.redirected === true) {
      throw new Error('CALL-E response was redirected; refusing it.');
    }
    if (typeof response.url === 'string' && response.url !== '') {
      let origin;
      try {
        origin = new URL(response.url).origin;
      } catch {
        origin = null;
      }
      if (origin !== this.origin) {
        throw new Error('CALL-E response came from an origin other than the pinned API origin; refusing it.');
      }
    }
  }

  // The one place a live destination is decided. The number must parse as a complete
  // E.164 number, must not be one reserved for fiction (every sample in this repo is), and
  // must be on the operator's CALLE_ALLOWED_DESTINATIONS list — nothing is authorized by
  // default, so an unconfigured install can never place a real call.
  _authorizedDestination(task) {
    const supplier = (task.suppliers && task.suppliers[0]) || null;
    if (!supplier) {
      throw new Error('Task has no supplier to call.');
    }
    const destination = parseDestination(supplier.phone);
    const shown = maskPhone(destination);
    if (this.isFictionalDestination(destination)) {
      throw new Error(
        `Supplier phone ${shown} is in a range reserved for fiction (a sample number, never a ` +
        'real line); refusing to dial it live.'
      );
    }
    if (this.allowedDestinations.size === 0) {
      throw new Error(
        'No live destinations are authorized: set CALLE_ALLOWED_DESTINATIONS to the E.164 ' +
        'number(s) you are permitted to call. Refusing to dial.'
      );
    }
    if (!this.allowedDestinations.has(destination)) {
      throw new Error(
        `Supplier phone ${shown} is not in CALLE_ALLOWED_DESTINATIONS; refusing to dial a ` +
        'number the operator has not authorized.'
      );
    }
    return destination;
  }

  async placeCall(task, { onStatusChange, signal, scenario } = {}) {
    if (!this.apiKey) {
      throw new Error(
        'CALLE_API_KEY is not set; see README.md for the real-provider env vars. Refusing to dial.'
      );
    }
    assertUsableApiKey(this.apiKey);

    // Authorized and built before anything is announced or sent: a refused destination
    // never touches the network and never marks the task "dialing".
    const body = JSON.stringify(buildCallRequest(task, scenario, this._authorizedDestination(task)));

    if (onStatusChange) {
      onStatusChange('dialing', new Date().toISOString());
    }

    const createResponse = await this._fetch('/v1/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        // Stable for one approval, different after the next one: a lost response can
        // be re-sent without dialing twice, while re-planning and re-approving a task
        // (which is how this app asks for a second call) deliberately gets a new key.
        'Idempotency-Key': `${task.id || 'task'}:${task.approvedAt || 'unapproved'}`
      },
      body,
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
    const callId = String(created.id);
    if (!CALL_ID_PATTERN.test(callId) || callId === '.' || callId === '..') {
      throw new Error('CALL-E accepted the call but returned an id that is not a plain token; refusing to poll it.');
    }
    const terminal = await this._pollUntilTerminal(callId, signal, onStatusChange);

    if (onStatusChange) {
      onStatusChange('done', new Date().toISOString());
    }

    return parseCallEResponse(terminal);
  }

  async _pollUntilTerminal(callId, signal, onStatusChange) {
    const deadline = Date.now() + this.pollTimeoutMs;
    let announcedConnected = false;

    for (;;) {
      const response = await this._fetch(`/v1/calls/${encodeURIComponent(callId)}`, {
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

module.exports = {
  CallEProvider,
  parseCallEResponse,
  buildCallRequest,
  parseDestination,
  parseAllowlistEnv,
  APPROVED_API_ORIGINS,
  DEFAULT_BASE_URL,
  RESULT_SCHEMA
};

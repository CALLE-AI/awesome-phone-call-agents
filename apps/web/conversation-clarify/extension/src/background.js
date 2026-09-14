/**
 * The only part of the extension that talks to the server.
 *
 * The CALL-E API key is not here and cannot be. The extension holds one shared
 * secret for our own backend; the backend holds the CALL-E credential and is
 * the only thing that ever sends it anywhere. This follows CALL-E's own
 * instruction not to call the Developer API from a browser or untrusted client.
 */

const DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8000',
  token: 'local-dev-token',
  callerName: '',
};

async function settings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function call(path, options = {}) {
  const { serverUrl, token } = await settings();
  const base = String(serverUrl).replace(/\/+$/, '');

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    return {
      ok: false,
      error:
        `Could not reach the Conversation Clarify server at ${base}. ` +
        'Start it, or set the address in the extension options.',
    };
  }

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    const detail = (body && (body.detail || body.message)) || `HTTP ${response.status}`;
    return { ok: false, error: String(detail), status: response.status };
  }
  return { ok: true, data: body };
}

const ROUTES = {
  analyze: (payload) => call('/v1/analyze', {
    method: 'POST',
    body: JSON.stringify({ ...payload.thread, rules_only: Boolean(payload.rulesOnly) }),
  }),
  propose: (payload) => call('/v1/proposals', { method: 'POST', body: JSON.stringify(payload) }),
  place: (payload) =>
    call(`/v1/proposals/${encodeURIComponent(payload.proposalId)}/call`, {
      method: 'POST',
      body: JSON.stringify({ confirm: payload.confirm }),
    }),
  result: (payload) => call(`/v1/proposals/${encodeURIComponent(payload.proposalId)}`),
  health: () => call('/health'),
  settings: async () => ({ ok: true, data: await settings() }),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const route = ROUTES[message && message.type];
  if (!route) {
    sendResponse({ ok: false, error: `Unknown request: ${message && message.type}` });
    return false;
  }
  route(message).then(sendResponse);
  return true; // keep the channel open for the async reply
});

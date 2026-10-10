const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4005/api';
const TOKEN_KEY = 'snoozetax_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Thrown for any non-2xx response so callers can show `err.code`. */
export class ApiError extends Error {
  constructor(code, message, body) {
    super(message || code);
    this.code = code;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `http_${res.status}`, data.message, data);
  return data;
}

/**
 * The admin prompt inspector. Authenticated with its own key rather than the
 * user session, and deliberately never persisted: it is typed in each time so
 * the key does not sit in localStorage on a machine used for demos.
 */
export async function adminPrompts(key) {
  const res = await fetch(BASE + '/admin/prompts', { headers: { 'X-Admin-Key': key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `http_${res.status}`, data.message, data);
  return data;
}

/** Human-readable text for the error codes the API returns. */
export const ERRORS = {
  invalid_phone: 'That number needs the country code, like +34 600 000 000.',
  name_required: 'Add your name so the call knows who it is waking up.',
  wrong_code: 'That code does not match. Check the call again.',
  code_expired: 'That code expired. Request a new call.',
  too_many_attempts: 'Too many tries. Request a new call.',
  no_pending_verification: 'Start again to get a new call.',
  // No generic text for these two: the server forwards CALL-E's own reason
  // (rejected task, no credit, bad number), and that is what the user needs to
  // read. A blanket "check the backend" sent people debugging a healthy server.
  call_failed: null,
  wrong: 'Not the right answer. Try again.',
  expired: 'The ten minutes are up.',
  not_found: 'That link is no longer valid.',
  multi_alarm_soon: 'One alarm for now. Multi-alarm is coming.',
  contact_is_self: 'Your accountability contact has to be someone else.',
  consent_declined: 'They said no, and that is final. Use a different number.',
  consent_call_failed: null,
  no_contact: 'Add a contact number first.',
  bad_admin_key: 'That admin key is not right.',
  admin_not_configured: 'No admin key is configured on the server.',
};

export const errorText = (err) =>
  ERRORS[err?.code] || err?.message || 'Something went wrong.';

// ERRORS values may be null on purpose (see call_failed): that falls through to
// the server's own message rather than masking it.

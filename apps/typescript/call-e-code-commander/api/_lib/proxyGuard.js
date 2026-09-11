/**
 * Request guard for the CALL-E proxy.
 *
 * The proxy exists so the browser never holds a key. That solves the problem of
 * a credential leaking out of the page, and creates a different one: the proxy
 * itself now signs every request that reaches it. A deployed copy with no guard
 * is an open relay. Anyone who finds the URL can post a call task of their own
 * wording to a number of their choosing, and it is placed on the owner's key,
 * billed to the owner's balance, and dialled from the owner's number.
 *
 * So the proxy forwards a narrow, named set of requests and refuses everything
 * else. Three separate controls, because each covers a different failure:
 *
 *   1. Route allowlist     — the proxy is a call-escalation backend, not a
 *                            general gateway to the account's whole API surface.
 *   2. Recipient allowlist — a hosted demo may only ring numbers its owner
 *                            nominated. This is the control that stops a
 *                            stranger placing a call to a stranger.
 *   3. Rate limit          — bounds the spend and the noise from anyone who is
 *                            allowed through the first two.
 *
 * Everything here is a pure function over an inbound request, so the same rules
 * are exercised by the test suite and shared by the dev middleware and the
 * deployed function rather than written twice and drifting apart.
 */

/**
 * Routes the escalation ladder actually uses.
 *
 * `create` is separated from the read routes because it is the only one that
 * spends money and rings a phone, and it carries a much tighter budget.
 */
const ROUTES = [
  { kind: 'create', method: 'POST', pattern: /^\/v1\/calls\/?$/ },
  { kind: 'read', method: 'GET', pattern: /^\/v1\/calls\/[A-Za-z0-9_-]+\/?$/ },
  { kind: 'read', method: 'GET', pattern: /^\/v1\/calls\/[A-Za-z0-9_-]+\/events\/?$/ }
];

/** Ceiling on the task brief, so the proxy is not a megaphone for arbitrary text. */
const MAX_TASK_CHARS = 8000;

/**
 * Request budgets, per client address, in a fixed window.
 *
 * The create budget is deliberately small. Paging a three-rung rota is three
 * calls, so five in ten minutes covers a genuine incident and a retry, and
 * nothing like a sustained dialling campaign.
 *
 * The read budget has to cover polling. A live rung is read twice every three
 * seconds for up to seven minutes, so a single escalation can legitimately make
 * several hundred reads.
 */
export const LIMITS = {
  create: { max: 5, windowMs: 10 * 60 * 1000 },
  read: { max: 900, windowMs: 10 * 60 * 1000 },
  /** Across every client, so one deployment cannot be drained by many addresses. */
  globalCreate: { max: 20, windowMs: 60 * 60 * 1000 }
};

/**
 * Classifies an inbound path against the route allowlist.
 *
 * @param {string} method
 * @param {string} pathname Path with the proxy mount already stripped, e.g. /v1/calls.
 * @returns {{allowed: boolean, kind: string|null}}
 */
export function classifyRoute(method, pathname) {
  const verb = (method || '').toUpperCase();
  const path = (pathname || '').split('?')[0];
  for (const route of ROUTES) {
    if (route.method === verb && route.pattern.test(path)) {
      return { allowed: true, kind: route.kind };
    }
  }
  return { allowed: false, kind: null };
}

/** Normalises a number the way the app does before comparing it to the allowlist. */
export function normalisePhone(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(/[^\d+]/g, '').trim();
  if (!cleaned) return '';
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Numbers a deployment is permitted to ring.
 *
 * Two sources, both server configuration. The rota is included because those
 * are by definition the numbers this deployment exists to call, so a correctly
 * configured demo needs no extra variable. CALLE_DEMO_ALLOWED_NUMBERS adds
 * anything else the owner wants reachable, such as a reviewer's own phone.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {string[]} Normalised E.164 numbers, deduplicated.
 */
export function readAllowedNumbers(env = {}) {
  const fromList = String(env.CALLE_DEMO_ALLOWED_NUMBERS || '')
    .split(/[,\s]+/)
    .map(normalisePhone)
    .filter(Boolean);

  const fromRota = ['CALLE_ROTA_PRIMARY_PHONE', 'CALLE_ROTA_BACKUP_PHONE', 'CALLE_ROTA_MANAGER_PHONE']
    .map((key) => normalisePhone(env[key]))
    .filter(Boolean);

  return [...new Set([...fromList, ...fromRota])];
}

/**
 * Fixed-window request counter.
 *
 * Held in the process, which is the honest limit of what a serverless function
 * can do without a shared store: a host running several instances counts each
 * one separately, so this bounds a burst rather than guaranteeing a global
 * ceiling. It is the third control for that reason, not the first. The recipient
 * allowlist is what actually stops an unwanted call, and it does not depend on
 * which instance the request landed on.
 */
export class RateLimiter {
  constructor(limits = LIMITS) {
    this.limits = limits;
    this.windows = new Map();
  }

  /**
   * @returns {{allowed: boolean, retryAfterSeconds: number}}
   */
  check(key, kind, now = Date.now()) {
    const limit = this.limits[kind];
    if (!limit) return { allowed: true, retryAfterSeconds: 0 };

    const id = `${kind}:${key}`;
    const entry = this.windows.get(id);

    if (!entry || now >= entry.resetAt) {
      this.windows.set(id, { count: 1, resetAt: now + limit.windowMs });
      this.sweep(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (entry.count >= limit.max) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }

    entry.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drops expired windows so a long-lived process does not grow a map per address. */
  sweep(now) {
    if (this.windows.size < 500) return;
    for (const [id, entry] of this.windows) {
      if (now >= entry.resetAt) this.windows.delete(id);
    }
  }
}

/**
 * Applies every control to one inbound proxy request.
 *
 * @param {object} input
 * @param {string} input.method
 * @param {string} input.pathname       Path with the /api/calle mount stripped.
 * @param {Buffer|string|null} [input.body] Raw request body, parsed only for create.
 * @param {Record<string, string|undefined>} [input.env]
 * @param {string} [input.clientId]     Whatever identifies the caller, usually an address.
 * @param {RateLimiter} input.limiter
 * @param {boolean} [input.enforceRecipientAllowlist] True on a public deployment.
 * @param {number} [input.now]
 * @returns {{ok: boolean, kind: string|null, status?: number, error?: object, retryAfterSeconds?: number}}
 */
export function guardProxyRequest({
  method,
  pathname,
  body = null,
  env = {},
  clientId = 'unknown',
  limiter,
  enforceRecipientAllowlist = false,
  now = Date.now()
}) {
  const route = classifyRoute(method, pathname);
  if (!route.allowed) {
    return {
      ok: false,
      kind: null,
      status: 404,
      error: {
        code: 'route_not_proxied',
        message: 'This proxy forwards only the call routes the escalation ladder uses: create a call, read a call, and list its events. Nothing else on the account is reachable through it.',
        details: {}
      }
    };
  }

  if (route.kind === 'create') {
    const parsed = parseBody(body);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: route.kind,
        status: 400,
        error: { code: 'invalid_request', message: 'The call payload was not readable JSON.', details: {} }
      };
    }

    const payload = parsed.value || {};
    const task = typeof payload.task === 'string' ? payload.task : '';
    if (task.length > MAX_TASK_CHARS) {
      return {
        ok: false,
        kind: route.kind,
        status: 413,
        error: {
          code: 'task_too_long',
          message: `The call brief is longer than the ${MAX_TASK_CHARS} characters this proxy forwards.`,
          details: {}
        }
      };
    }

    // An incident call is always placed for an incident. Requiring the
    // correlation id keeps the proxy tied to this application rather than
    // serving as a general call endpoint that happens to be reachable.
    const incidentId = payload.metadata?.incident_id;
    if (typeof incidentId !== 'string' || !incidentId) {
      return {
        ok: false,
        kind: route.kind,
        status: 400,
        error: {
          code: 'missing_incident_metadata',
          message: 'Calls through this proxy must carry metadata.incident_id, which is how a call is correlated back to the incident it belongs to.',
          details: {}
        }
      };
    }

    const recipientCheck = checkRecipient(payload, env, enforceRecipientAllowlist);
    if (!recipientCheck.ok) return { ok: false, kind: route.kind, ...recipientCheck };
  }

  if (route.kind === 'create') {
    const global = limiter.check('all', 'globalCreate', now);
    if (!global.allowed) {
      return {
        ok: false,
        kind: route.kind,
        status: 429,
        retryAfterSeconds: global.retryAfterSeconds,
        error: {
          code: 'demo_budget_exhausted',
          message: 'This deployment has placed as many calls as it allows in an hour. It is a public demo running on one prepaid balance, so the ceiling is deliberate. Run it locally with your own key to dial without it.',
          details: {}
        }
      };
    }
  }

  const perClient = limiter.check(clientId, route.kind, now);
  if (!perClient.allowed) {
    return {
      ok: false,
      kind: route.kind,
      status: 429,
      retryAfterSeconds: perClient.retryAfterSeconds,
      error: {
        code: 'proxy_rate_limited',
        message: route.kind === 'create'
          ? 'Too many calls placed from this address in a short window. Wait for the window to clear before paging the rota again.'
          : 'Too many reads from this address in a short window.',
        details: {}
      }
    };
  }

  return { ok: true, kind: route.kind };
}

/**
 * Decides whether this deployment may ring the number in a call payload.
 *
 * On a public deployment an empty allowlist denies every call rather than
 * allowing every call. A misconfigured demo that rings nobody is a bad demo. A
 * misconfigured demo that rings anybody is somebody else's phone at 3am.
 */
function checkRecipient(payload, env, enforce) {
  const phone = normalisePhone(payload?.recipient?.phone);

  if (!phone) {
    return {
      ok: false,
      status: 400,
      error: { code: 'invalid_recipient', message: 'The call payload carried no recipient phone number.', details: {} }
    };
  }

  if (!enforce) {
    // A dev server is the operator's own machine, holding the operator's own
    // key, dialling from the operator's own terminal. Restricting it there
    // would block the one workflow the restriction exists to protect: an
    // engineer testing their own rota against their own phone.
    return { ok: true };
  }

  const allowed = readAllowedNumbers(env);

  if (allowed.length === 0) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'no_numbers_allowed',
        message: 'This deployment has no allowed destinations configured, so it will not place a call. Set CALLE_DEMO_ALLOWED_NUMBERS, or the CALLE_ROTA_*_PHONE variables, in the hosting environment.',
        details: {}
      }
    };
  }

  if (!allowed.includes(phone)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'recipient_not_allowed',
        message: 'This hosted demo only rings numbers its owner nominated, so it cannot be used to call a stranger on the owner’s account. Simulation mode still runs the whole ladder here. To ring your own phone, clone the repository and run it with your own CALL-E key.',
        details: {}
      }
    };
  }

  return { ok: true };
}

function parseBody(body) {
  if (body === null || body === undefined) return { ok: true, value: {} };
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    if (!text.trim()) return { ok: true, value: {} };
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

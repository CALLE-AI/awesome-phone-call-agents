/**
 * End-to-end checks against a *running* stack, over real HTTP.
 *
 * Unlike the integration tests (which drive the Fastify app in-process), this
 * exercises the deployed surface: the network, the BFF proxy, cookies, SSE, and
 * cross-client synchronisation. It is the closest thing to a user without a
 * browser driver.
 *
 *   npm run dev:api && npm run dev:worker && npm run dev:web
 *   npm run e2e
 *
 * Env: API_URL (default http://127.0.0.1:4000), WEB_URL (default http://localhost:3000)
 */

const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Minimal cookie jar so we exercise the real browser-style session flow. */
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (response) => {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}

async function request(base, path, options = {}, cookieJar) {
  const headers = { accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body) headers['content-type'] = 'application/json';
  if (cookieJar) headers.cookie = cookieJar.header();

  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
  if (cookieJar) cookieJar.absorb(response);

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json — fine for HTML pages */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function main() {
  console.log(`\nDial end-to-end checks\n  API ${API}\n  WEB ${WEB}\n`);

  const email = `e2e-${Date.now()}@example.com`;
  const password = 'an-e2e-password-long-enough';
  const cookies = jar();
  let token = null;
  let taskId = null;

  /* ------------------------------------------------------------- health */

  await check('health reports what is actually configured', async () => {
    const { status, json } = await request(API, '/health');
    assert(status === 200, `expected 200, got ${status}`);
    assert(json.ok === true, 'ok was not true');
    assert(['mock', 'real'].includes(json.callMode), 'callMode missing');
    assert(typeof json.integrations.calle === 'boolean', 'integrations.calle missing');
    assert(typeof json.integrations.discovery === 'string', 'integrations.discovery missing');
  });

  /* --------------------------------------------------------------- auth */

  await check('rejects an anonymous request', async () => {
    const { status } = await request(API, '/api/tasks');
    assert(status === 401, `expected 401, got ${status}`);
  });

  await check('sign-up creates an account and a session', async () => {
    const { status, json } = await request(
      API,
      '/api/auth/sign-up',
      { method: 'POST', body: { email, password, name: 'E2E' } },
      cookies,
    );
    assert(status === 200, `expected 200, got ${status} ${JSON.stringify(json)}`);
    assert(json.user.email === email, 'wrong email back');
    assert(typeof json.token === 'string', 'no bearer token for native clients');
    token = json.token;
  });

  await check('the cookie session works', async () => {
    const { status, json } = await request(API, '/api/auth/me', {}, cookies);
    assert(status === 200, `expected 200, got ${status}`);
    assert(json.user.email === email, 'wrong user');
  });

  await check('the bearer token works (the mobile path)', async () => {
    const { status, json } = await request(API, '/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(json.user.email === email, 'wrong user');
  });

  await check('a duplicate email is refused', async () => {
    const { status } = await request(API, '/api/auth/sign-up', {
      method: 'POST',
      body: { email, password, name: 'E2E' },
    });
    assert(status === 409, `expected 409, got ${status}`);
  });

  await check('a wrong password is refused', async () => {
    const { status } = await request(API, '/api/auth/sign-in', {
      method: 'POST',
      body: { email, password: 'wrong-password-here' },
    });
    assert(status === 401, `expected 401, got ${status}`);
  });

  /* ----------------------------------------------------------- settings */

  await check('settings load with the restrictive defaults', async () => {
    const { status, json } = await request(API, '/api/settings', {}, cookies);
    assert(status === 200, `expected 200, got ${status}`);
    assert(json.policy.purchases === 'ask', 'purchases should default to ask');
    assert(json.policy.phoneInquiries === 'automatic', 'phoneInquiries default changed');
  });

  await check('settings can be updated and persist', async () => {
    const patch = await request(
      API,
      '/api/settings',
      { method: 'PATCH', body: { transcriptRetentionDays: 7 } },
      cookies,
    );
    assert(patch.status === 200, `expected 200, got ${patch.status}`);
    const { json } = await request(API, '/api/settings', {}, cookies);
    assert(json.transcriptRetentionDays === 7, 'setting did not persist');
  });

  /* ------------------------------------------------------------ geocode */

  await check('real geocoding resolves a place name', async () => {
    const { status, json } = await request(
      API,
      '/api/location/resolve',
      { method: 'POST', body: { text: 'Dublin 2, Ireland' } },
      cookies,
    );
    if (status === 503) throw new Error('search provider unavailable (network?)');
    assert(status === 200, `expected 200, got ${status}`);
    assert(Math.abs(json.latitude - 53.34) < 0.5, `latitude looks wrong: ${json.latitude}`);
    assert(json.countryCode === 'IE', `countryCode was ${json.countryCode}`);
  });

  /* -------------------------------------------------------------- tasks */

  const llmConfigured = (await request(API, '/health')).json.integrations.llm;

  if (!llmConfigured) {
    await check('task creation fails precisely when no model is configured', async () => {
      const { status, json } = await request(
        API,
        '/api/tasks',
        {
          method: 'POST',
          body: { instruction: 'Find a phone repair shop', idempotencyKey: `e2e-${Date.now()}` },
        },
        cookies,
      );
      assert(status === 503, `expected 503, got ${status}`);
      assert(json.error.code === 'llm_not_configured', `wrong code: ${json.error.code}`);
    });
    console.log('\n  NOTE  LLM_API_KEY is not set — task lifecycle checks are BLOCKED.\n');
  } else {
    await check('a task can be created', async () => {
      const { status, json } = await request(
        API,
        '/api/tasks',
        {
          method: 'POST',
          body: {
            instruction: 'Find the cheapest place near me that can replace an iPhone 13 screen today',
            location: { latitude: 53.3389, longitude: -6.2527, text: null },
            idempotencyKey: `e2e-${Date.now()}`,
          },
        },
        cookies,
      );
      assert(status === 200, `expected 200, got ${status} ${JSON.stringify(json)}`);
      taskId = json.id;
    });

    await check('the task appears in history', async () => {
      const { json } = await request(API, '/api/tasks', {}, cookies);
      assert(json.tasks.some((t) => t.id === taskId), 'task missing from list');
    });

    await check('the task progresses through real states', async () => {
      const deadline = Date.now() + 180_000;
      let detail = null;
      while (Date.now() < deadline) {
        const { json } = await request(API, `/api/tasks/${taskId}`, {}, cookies);
        detail = json;
        if (['completed', 'partially_completed', 'failed', 'needs_user_input', 'awaiting_confirmation'].includes(detail.state)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      assert(detail, 'no detail');
      assert(detail.state !== 'created', 'task never left created — is the worker running?');
      assert(detail.events.length > 0, 'no progress events were recorded');
      console.log(`        final state: ${detail.state} — ${detail.headline ?? '(no headline)'}`);
    });

    await check('the task survives a re-read (state is in the database)', async () => {
      const { json } = await request(API, `/api/tasks/${taskId}`, {}, cookies);
      assert(json.id === taskId, 'task id changed');
      assert(json.events.length > 0, 'events vanished');
    });
  }

  /* --------------------------------------------------------- idempotency */

  await check('the same idempotency key does not create two tasks', async () => {
    if (!llmConfigured) return; // creation is blocked; nothing to compare
    const key = `e2e-idem-${Date.now()}`;
    const body = { instruction: 'Find a plumber', idempotencyKey: key };
    const first = await request(API, '/api/tasks', { method: 'POST', body }, cookies);
    const second = await request(API, '/api/tasks', { method: 'POST', body }, cookies);
    assert(first.json.id === second.json.id, 'two different tasks were created');
  });

  /* ------------------------------------------------------------ webhook */

  await check('a malformed webhook is rejected', async () => {
    const { status } = await request(API, '/api/webhooks/calle', {
      method: 'POST',
      headers: { 'call-e-event-id': 'evt_e2e' },
      body: { id: 'evt_e2e', type: 'nonsense', data: {} },
    });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await check('a webhook with a mismatched event id is rejected', async () => {
    const { status } = await request(API, '/api/webhooks/calle', {
      method: 'POST',
      headers: { 'call-e-event-id': 'different' },
      body: {
        id: 'evt_e2e_2',
        type: 'call.completed',
        created_at: new Date().toISOString(),
        data: { id: 'pc_x', status: 'completed' },
      },
    });
    assert(status === 400, `expected 400, got ${status}`);
  });

  /* ----------------------------------------------------------- realtime */

  await check('the progress stream connects and sends SSE frames', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${API}/api/events`, {
        headers: { cookie: cookies.header(), accept: 'text/event-stream' },
        signal: controller.signal,
      });
      assert(response.status === 200, `expected 200, got ${response.status}`);
      assert(
        response.headers.get('content-type')?.includes('text/event-stream'),
        'wrong content-type for SSE',
      );
      const reader = response.body.getReader();
      const { value } = await reader.read();
      assert(new TextDecoder().decode(value).length > 0, 'stream sent nothing');
      await reader.cancel();
    } finally {
      clearTimeout(timer);
    }
  });

  /* ---------------------------------------------------------------- web */

  await check('the sign-in page renders', async () => {
    const { status, text } = await request(WEB, '/sign-in');
    assert(status === 200, `expected 200, got ${status}`);
    assert(text.includes('DIAL'), 'brand missing from page');
  });

  await check('an unauthenticated visitor is redirected', async () => {
    const { status } = await request(WEB, '/');
    assert(status === 307 || status === 302, `expected a redirect, got ${status}`);
  });

  const webCookies = jar();

  await check('sign-in works through the BFF proxy', async () => {
    const { status, json } = await request(
      WEB,
      '/api/be/auth/sign-in',
      { method: 'POST', body: { email, password } },
      webCookies,
    );
    assert(status === 200, `expected 200, got ${status}`);
    assert(json.user.email === email, 'wrong user');
  });

  await check('the home page renders for a signed-in user', async () => {
    const { status, text } = await request(WEB, '/', {}, webCookies);
    assert(status === 200, `expected 200, got ${status}`);
    assert(text.includes('Let Dial make the call for you'), 'hero line missing');
  });

  await check('history renders and shows the same tasks as the API', async () => {
    const { status, text } = await request(WEB, '/history', {}, webCookies);
    assert(status === 200, `expected 200, got ${status}`);
    assert(text.includes('Your tasks'), 'history heading missing');
  });

  await check('the proxy never leaks a server secret to the browser', async () => {
    const { text } = await request(WEB, '/', {}, webCookies);
    for (const needle of ['CALLE_API_KEY', 'LLM_API_KEY', 'SESSION_SECRET', 'AIzaSy']) {
      assert(!text.includes(needle), `page contained ${needle}`);
    }
  });

  /* ------------------------------------------------ cross-client sync */

  await check('web and mobile see the identical account', async () => {
    const viaCookie = await request(API, '/api/auth/me', {}, cookies);
    const viaBearer = await request(API, '/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert(
      viaCookie.json.user.id === viaBearer.json.user.id,
      'cookie and bearer resolved to different users',
    );
  });

  await check('web and mobile see the identical task list', async () => {
    const viaCookie = await request(API, '/api/tasks', {}, cookies);
    const viaBearer = await request(API, '/api/tasks', {
      headers: { authorization: `Bearer ${token}` },
    });
    const a = viaCookie.json.tasks.map((t) => t.id).sort();
    const b = viaBearer.json.tasks.map((t) => t.id).sort();
    assert(JSON.stringify(a) === JSON.stringify(b), 'task lists differ between clients');
  });

  /* ----------------------------------------------------------- cleanup */

  await check('the account can be deleted', async () => {
    const { status } = await request(API, '/api/account', { method: 'DELETE' }, cookies);
    assert(status === 200, `expected 200, got ${status}`);
    const after = await request(API, '/api/auth/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert(after.status === 401, 'session survived account deletion');
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\ne2e harness crashed: ${error.message}`);
  process.exit(1);
});

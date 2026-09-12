#!/usr/bin/env node
'use strict';

// Isolated browser regression checks. Every call endpoint is fulfilled here;
// no call request can reach the local server or an external provider.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const origin = process.env.MEASUREBACK_TEST_ORIGIN || 'http://127.0.0.1:8793';
const parsed = new URL(origin);
assert.equal(parsed.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Only loopback is permitted');
const lockKey = 'measureback.pending-call';
const checks = [];
const errors = [];
const forbidden = [];
const counts = { preview: 0, execute: 0, result: 0 };
let nextPreviewGate = null;
let executeGate = null;
let executeStatus = 503;
let resultBody = null;
let lastPreviewRequest = null;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function gate() { return { seen: deferred(), release: deferred() }; }

async function check(name, work) {
  await work();
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.workspace')?.getAttribute('aria-busy') === 'false'
    && document.querySelectorAll('#ingredients .ingredient').length === 6);
}

async function fillForm(page) {
  await page.locator('[name="requester"]').fill('Browser fixture');
  await page.locator('[name="cook_name"]').fill('Example Cook');
  await page.locator('[name="recipe_title"]').fill('Fictional safety interview');
  await page.locator('[name="phone"]').fill('+12025550123');
  await page.locator('[name="consent"]').check();
  await page.locator('[name="sharing_consent"]').check();
}

async function pendingLock(page) {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, lockKey);
}

function assertMinimalLock(value, state) {
  assert.ok(value);
  assert.deepEqual(Object.keys(value).sort(), ['call_id', 'request_id', 'state']);
  assert.match(value.request_id, /^[0-9a-f-]{36}$/i);
  assert.equal(value.state, state);
  assert.equal(JSON.stringify(value).includes('+12025550123'), false);
}

async function preview(page) {
  await page.locator('#preview-call').click();
  await page.locator('#execute-call').waitFor({ state: 'visible' });
  assert.match(await page.locator('#call-preview').textContent(), /•••• 0123/);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    // The catch-all route is installed before the page exists. Only loopback
    // assets and non-call APIs are ever continued to the network.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== parsed.origin) {
        forbidden.push(url.origin);
        return route.abort();
      }
      const fulfill = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/config.json') return fulfill({ local: true, live_enabled: true });
      if (url.pathname === '/api/call/preview') {
        counts.preview++;
        const { request } = route.request().postDataJSON();
        lastPreviewRequest = request;
        const held = nextPreviewGate;
        nextPreviewGate = null;
        if (held) {
          held.seen.resolve();
          await held.release.promise;
        }
        return fulfill({
          recipe_title: request.recipe_title,
          cook_name: request.cook_name,
          phone: '•••• 0123',
          locale: request.locale,
          language_mode: request.language_mode,
          window_end: request.window_end,
          side_effect: 'Fictional browser test; this route cannot dial.',
          cancellation: 'No provider request is made by this test.',
          approval_token: 'a'.repeat(64),
        });
      }
      if (url.pathname === '/api/call/execute') {
        counts.execute++;
        const held = executeGate;
        executeGate = null;
        if (held) {
          held.seen.resolve();
          await held.release.promise;
        }
        return executeStatus === 503
          ? fulfill({ error: 'Fictional provider response interrupted' }, 503)
          : fulfill({ state: 'submitted', call_id: 'fixture-call-001' });
      }
      if (url.pathname === '/api/call/result') {
        counts.result++;
        assert.deepEqual(route.request().postDataJSON(), { call_id: 'fixture-call-001' });
        return fulfill(resultBody || { state: 'pending' });
      }
      if (url.pathname.startsWith('/api/call/')) {
        forbidden.push(`Unhandled call route: ${url.pathname}`);
        return fulfill({ error: 'All call routes are blocked by the browser test' }, 400);
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 503/.test(message.text())) errors.push(message.text());
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await ready(page);
    assert.match(await page.locator('#live-note').textContent(), /Local calling is enabled/);
    await fillForm(page);

    await check('editing a pending preview discards its old approval', async () => {
      const held = gate();
      nextPreviewGate = held;
      await page.locator('#preview-call').click();
      await held.seen.promise;
      await page.locator('[name="recipe_title"]').fill('Changed fictional interview');
      held.release.resolve();
      await page.waitForFunction(() => document.querySelector('#call-state').textContent.includes('form changed'));
      assert.equal(await page.locator('#execute-call').isVisible(), false);
      assert.equal(await page.locator('#call-preview').isVisible(), false);
      assert.equal(counts.execute, 0);
    });

    await check('withdrawing consent during a pending preview discards approval', async () => {
      const held = gate();
      nextPreviewGate = held;
      await page.locator('#preview-call').click();
      await held.seen.promise;
      await page.locator('[name="consent"]').uncheck();
      held.release.resolve();
      await page.waitForFunction(() => document.querySelector('#call-state').textContent.includes('form changed'));
      assert.equal(await page.locator('#execute-call').isVisible(), false);
      assert.equal(await page.locator('#call-preview').isVisible(), false);
      assert.equal(counts.execute, 0);
      await page.locator('[name="consent"]').check();
    });

    let failedRequestId;
    await check('submission locks immediately and a 503 retains an uncertain reference', async () => {
      await preview(page);
      failedRequestId = lastPreviewRequest.request_id;
      const held = gate();
      executeGate = held;
      await page.locator('#execute-call').click();
      await held.seen.promise;
      const submitting = await pendingLock(page);
      assertMinimalLock(submitting, 'submitting');
      assert.equal(submitting.request_id, failedRequestId);
      assert.equal(submitting.call_id, null);
      assert.equal(await page.locator('#preview-call').isDisabled(), true);
      assert.equal(await page.locator('[name="phone"]').isDisabled(), true);
      await page.locator('#reconcile-check').check();
      assert.equal(await page.locator('#reconcile-call').isDisabled(), true);
      await page.locator('#reconcile-check').uncheck();
      held.release.resolve();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.state === 'unknown', lockKey);
      const uncertain = await pendingLock(page);
      assertMinimalLock(uncertain, 'unknown');
      assert.equal(uncertain.request_id, failedRequestId);
      assert.match(await page.locator('#call-state').textContent(), /locked until you review/);
      assert.equal(await page.locator('#execute-call').isVisible(), false);
      assert.equal(counts.execute, 1);
    });

    await check('reload preserves the uncertain lock and prevents another preview', async () => {
      const previousPreviewCount = counts.preview;
      await page.reload({ waitUntil: 'networkidle' });
      await ready(page);
      const restored = await pendingLock(page);
      assertMinimalLock(restored, 'unknown');
      assert.equal(restored.request_id, failedRequestId);
      assert.equal(await page.locator('#preview-call').isDisabled(), true);
      assert.equal(await page.locator('[name="consent"]').isDisabled(), true);
      assert.equal(await page.locator('#execute-call').isVisible(), false);
      assert.equal(counts.preview, previousPreviewCount);
      assert.equal(counts.execute, 1);
    });

    await check('explicit reconciliation is required and the next request gets a new ID', async () => {
      assert.equal(await page.locator('#reconcile-check').isChecked(), false);
      assert.equal(await page.locator('#reconcile-call').isDisabled(), true);
      await page.locator('#reconcile-check').check();
      assert.equal(await page.locator('#reconcile-call').isEnabled(), true);
      await page.locator('#reconcile-call').click();
      assert.equal(await pendingLock(page), null);
      assert.equal(await page.locator('#preview-call').isEnabled(), true);
      await fillForm(page);
      await preview(page);
      assert.notEqual(lastPreviewRequest.request_id, failedRequestId);
    });

    const fixture = await page.evaluate(async () => {
      const response = await fetch('/api/example?stage=corrected&servings=6');
      return response.json();
    });
    fixture.recipe.title = 'Reviewed browser fixture';
    resultBody = {
      state: 'completed', recipe: fixture.recipe, consent_review_required: true,
      consent_evidence: {
        capture: { quote: 'I agree to capture this fictional recipe.' },
        sharing: { quote: 'I agree to share it with the requester.' },
        source_transcript: [
          { speaker: 'agent', text: 'This is an authored browser test, not a real call.' },
          { speaker: 'cook', text: 'I agree to capture this fictional recipe.' },
          { speaker: 'cook', text: 'I agree to share it with the requester.' },
          ...fixture.recipe.transcript,
        ],
      },
    };

    await check('returned recipe waits for full transcript consent review', async () => {
      executeStatus = 200;
      await page.locator('#execute-call').click();
      await page.locator('#check-call').waitFor({ state: 'visible' });
      assertMinimalLock(await pendingLock(page), 'submitted');
      assert.equal((await pendingLock(page)).call_id, 'fixture-call-001');
      await page.locator('#check-call').click();
      await page.locator('#consent-review').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#mode-label').textContent(), 'Interactive example');
      assert.equal(await page.locator('#recipe-title').textContent(), 'Cumin rice');
      assert.equal(await page.locator('#consent-review').isChecked(), false);
      assert.equal(await page.locator('#accept-recipe').isDisabled(), true);
      await page.locator('#consent-panel summary').click();
      assert.match(await page.locator('#consent-panel details').textContent(), /authored browser test, not a real call/);
      assert.match(await page.locator('#consent-panel details').textContent(), /I agree to share it with the requester/);
      await page.locator('#consent-review').check();
      assert.equal(await page.locator('#accept-recipe').isEnabled(), true);
      await page.locator('#accept-recipe').click();
      await page.waitForFunction(() => document.querySelector('#mode-label').textContent === 'Imported recipe');
      assert.equal(await page.locator('#recipe-title').textContent(), 'Reviewed browser fixture');
      assert.equal(await page.locator('#consent-panel').isVisible(), false);
      assert.equal(await page.locator('#preview-call').isDisabled(), true);
      assert.equal(counts.execute, 2);
      assert.equal(counts.result, 1);
    });

    await check('all call traffic stayed inside route mocks without page errors', async () => {
      assert.deepEqual(forbidden, []);
      assert.deepEqual(errors, []);
      assert.equal(counts.preview, 4);
      assert.equal(counts.execute, 2);
      assert.equal(counts.result, 1);
    });
    await context.close();
    process.stdout.write(`Verified ${checks.length} call safety checks. All call endpoints mocked; no provider requests.\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

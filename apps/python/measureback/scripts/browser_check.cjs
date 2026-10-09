#!/usr/bin/env node
'use strict';

// Runs only against the explicitly selected loopback app in an isolated browser.
// Supply the installed Playwright package through NODE_PATH; no test runner needed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const origin = process.env.MEASUREBACK_TEST_ORIGIN || 'http://127.0.0.1:8793';
const parsed = new URL(origin);
assert.equal(parsed.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Only loopback is permitted');
const output = path.resolve(__dirname, '../artifacts/browser-check');
const checks = [];
const browserErrors = [];
const unexpectedResponses = [];
const forbiddenRequests = [];
let expectInvalidImport = false;

async function check(name, work) {
  await work();
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.workspace')?.getAttribute('aria-busy') === 'false'
    && document.querySelectorAll('#ingredients .ingredient').length === 6);
}

function row(page, name) {
  return page.locator('#ingredients .ingredient').filter({
    has: page.locator('.ingredient-name', { hasText: new RegExp(`^${name}`) }),
  });
}

async function amount(page, name, expected) {
  await page.waitForFunction(({name, expected}) => {
    const ingredient = [...document.querySelectorAll('#ingredients .ingredient')]
      .find(el => el.querySelector('.ingredient-name')?.textContent.startsWith(name));
    return ingredient?.querySelector('.quantity')?.textContent.startsWith(expected);
  }, {name, expected});
  assert.ok((await row(page, name).locator('.quantity').textContent()).startsWith(expected));
}

async function overflow(page, label) {
  const result = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1)
        && getComputedStyle(el).position !== 'absolute';
    }).slice(0, 8).map(el => ({tag: el.tagName, id: el.id, class: String(el.className)})),
  }));
  assert.ok(result.document <= result.viewport + 1, `${label} document overflows: ${JSON.stringify(result)}`);
  assert.ok(result.body <= result.viewport + 1, `${label} body overflows: ${JSON.stringify(result)}`);
  return result;
}

(async () => {
  await fs.mkdir(output, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', acceptDownloads: true});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== parsed.origin) {
        forbiddenRequests.push(url.origin);
        return route.abort();
      }
      if (url.pathname === '/api/call/execute') {
        forbiddenRequests.push('call execute attempted');
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !(expectInvalidImport && /Failed to load resource/.test(message.text()))) {
        browserErrors.push(message.text());
      }
    });
    page.on('response', response => {
      if (response.status() >= 400 && !(expectInvalidImport && new URL(response.url()).pathname === '/api/scale')) {
        unexpectedResponses.push({url: response.url(), status: response.status()});
      }
    });
    const start = await page.goto(origin, {waitUntil: 'networkidle'});
    assert.equal(start.status(), 200);
    await ready(page);

    await check('initial render and local font', async () => {
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.fonts.check('16px MB')), true);
      assert.match(await page.title(), /MeasureBack/);
      assert.equal(await page.locator('#error').isVisible(), false);
      assert.match(await page.locator('#live-note').textContent(), /live calling is disabled/i);
    });
    await check('stage 1 preserves the unknown rice bowl', async () => {
      assert.equal(await page.locator('[data-stage="unresolved"]').getAttribute('aria-pressed'), 'true');
      await amount(page, 'Rice', 'Measure needed');
      assert.equal(await page.locator('#measure-value').textContent(), '?');
      assert.match(await page.locator('#questions').textContent(), /bowl/i);
    });
    await check('stage 2 calibrates rice to 750 ml for six servings', async () => {
      await page.locator('[data-stage="clarified"]').click();
      await amount(page, 'Rice', '750 ml');
      assert.equal(await page.locator('#display-servings').textContent(), '6');
      assert.equal(await page.locator('#measure-value').textContent(), '750');
    });
    await check('stage 3 uses the water correction and opens its source', async () => {
      await page.locator('[data-stage="corrected"]').click();
      await amount(page, 'Water', '1350 ml');
      const water = row(page, 'Water');
      await water.locator('button').click();
      assert.equal(await water.locator('button').getAttribute('aria-expanded'), 'true');
      assert.equal(await water.locator('.evidence').isVisible(), true);
      assert.match(await water.locator('.evidence').textContent(), /900 ml.*1000 ml/);
      assert.match(await page.locator('#featured-quote').textContent(), /900 ml.*1000 ml/);
    });
    await check('selected water and open evidence persist when servings change', async () => {
      await page.getByRole('button', {name: 'One more serving'}).click();
      await page.waitForFunction(() => document.querySelector('#display-servings').textContent === '7');
      await page.getByRole('button', {name: 'One more serving'}).click();
      await amount(page, 'Water', '1800 ml');
      assert.equal(await page.locator('#display-servings').textContent(), '8');
      assert.equal(await page.locator('#measure-title').textContent(), 'The water measure');
      assert.equal(await page.locator('#measure-value').textContent(), '1800');
      assert.equal(await row(page, 'Water').locator('button').getAttribute('aria-expanded'), 'true');
      assert.equal(await row(page, 'Water').locator('.evidence').isVisible(), true);
      assert.match(await page.locator('#featured-quote').textContent(), /900 ml.*1000 ml/);
      await page.getByRole('button', {name: 'One fewer serving'}).click();
      await page.waitForFunction(() => document.querySelector('#display-servings').textContent === '7');
      await page.getByRole('button', {name: 'One fewer serving'}).click();
      await amount(page, 'Water', '1350 ml');
      assert.equal(await page.locator('#measure-title').textContent(), 'The water measure');
      assert.equal(await page.locator('#measure-value').textContent(), '1350');
      assert.equal(await row(page, 'Water').locator('.evidence').isVisible(), true);
    });
    await check('fractional pieces require a decision; salt and timing are not multiplied', async () => {
      const cinnamon = row(page, 'Cinnamon stick');
      assert.match(await cinnamon.locator('.quantity').textContent(), /1\.5 pieces.*Decide how to divide/);
      assert.match(await cinnamon.locator('.quantity').getAttribute('class'), /needs_review/);
      assert.match(await row(page, 'Salt').textContent(), /To taste.*Not multiplied/);
      assert.match(await page.locator('#steps').textContent(), /18 min · as spoken/);
      assert.match(await page.locator('#steps').textContent(), /5 min · as spoken/);
    });
    await check('four servings restore 500 ml rice and 900 ml water', async () => {
      await page.getByRole('button', {name: 'One fewer serving'}).click();
      await page.waitForFunction(() => document.querySelector('#display-servings').textContent === '5');
      await page.getByRole('button', {name: 'One fewer serving'}).click();
      await amount(page, 'Rice', '500 ml');
      await amount(page, 'Water', '900 ml');
      assert.match(await page.locator('#steps').textContent(), /18 min · as spoken/);
      assert.match(await row(page, 'Salt').textContent(), /To taste.*Not multiplied/);
    });

    let exported;
    await check('exported recipe imports through the visible file control', async () => {
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', {name: /Save recipe/}).click();
      const download = await downloadEvent;
      exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      assert.equal(exported.recipe.title, 'Cumin rice');
      await page.locator('#import-file').setInputFiles({name: 'measureback-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))});
      await page.waitForFunction(() => document.querySelector('#mode-label').textContent === 'Imported recipe');
      await amount(page, 'Rice', '500 ml');
      await amount(page, 'Water', '900 ml');
      assert.equal(await page.locator('#reset-example').isVisible(), true);
    });
    await check('invalid recipe is rejected without replacing the current recipe', async () => {
      const invalid = structuredClone(exported);
      invalid.recipe.servings = 0;
      expectInvalidImport = true;
      await page.locator('#import-file').setInputFiles({name: 'invalid-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid))});
      await page.locator('#error').waitFor({state: 'visible'});
      assert.match(await page.locator('#error').textContent(), /validation failed|servings|positive/i);
      assert.equal(await page.locator('#mode-label').textContent(), 'Imported recipe');
      assert.equal(await page.locator('#recipe-title').textContent(), 'Cumin rice');
      await amount(page, 'Water', '900 ml');
      expectInvalidImport = false;
    });
    await page.locator('#reset-example').click();
    await page.waitForFunction(() => document.querySelector('#mode-label').textContent === 'Interactive example');

    await check('reserved-number preview is masked and cannot dial', async () => {
      await page.locator('[name="requester"]').fill('Fixture');
      await page.locator('[name="cook_name"]').fill('Example Cook');
      await page.locator('[name="recipe_title"]').fill('Fictional cumin rice interview');
      await page.locator('[name="phone"]').fill('+12025550123');
      await page.locator('[name="consent"]').check();
      await page.locator('[name="sharing_consent"]').check();
      await page.locator('[name="language_mode"]').selectOption('adaptive');
      await page.getByRole('button', {name: 'Preview the call', exact: true}).click();
      await page.locator('#call-preview').waitFor({state: 'visible'});
      const preview = await page.locator('#call-preview').textContent();
      assert.match(preview, /•••• 0123/);
      assert.equal(preview.includes('+12025550123'), false);
      assert.match(preview, /adaptive/);
      assert.equal(await page.locator('#execute-call').isVisible(), false);
      assert.match(await page.locator('#call-state').textContent(), /Live calling is disabled/);
    });

    await page.goto(origin, {waitUntil: 'networkidle'});
    await ready(page);
    await page.locator('[data-stage="corrected"]').click();
    await amount(page, 'Water', '1350 ml');
    await row(page, 'Water').locator('button').click();
    await check('desktop has no horizontal overflow', () => overflow(page, 'desktop'));
    await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true});

    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true});
    await check('mobile has no horizontal overflow', () => overflow(page, 'mobile'));

    await check('no unexpected browser errors, HTTP failures or outbound calls', async () => {
      assert.deepEqual(browserErrors, []);
      assert.deepEqual(unexpectedResponses, []);
      assert.deepEqual(forbiddenRequests, []);
    });
    await fs.writeFile(path.join(output, 'browser-check.json'), JSON.stringify({origin, checks, screenshots: ['desktop.png', 'mobile.png'], browserErrors, unexpectedResponses, forbiddenRequests}, null, 2));
    await context.close();
    process.stdout.write(`Verified ${checks.length} browser checks. Screenshots: ${output}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

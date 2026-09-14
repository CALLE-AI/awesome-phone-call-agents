import { test, expect, type Page } from '@playwright/test';

async function start(page: Page, kind: 'repair' | 'rental' | 'venue') {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A little certainty. A lot less calling.' }),
  ).toBeVisible();
  const names = {
    repair: 'Find a repair service The right repair',
    rental: 'Find an item or rental The exact item',
    venue: 'Check a venue or visit A place',
  };
  await page.getByRole('button', { name: new RegExp(names[kind]) }).click();
  await expect(page.getByRole('button', { name: 'Preview inquiry' })).toBeEnabled();
}
async function check(page: Page) {
  await page.getByRole('button', { name: 'Preview inquiry' }).click();
  await expect(page.getByRole('dialog')).toContainText('makes no phone calls');
  await page.getByRole('button', { name: 'Load fictional responses' }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
}
test('repair: source evidence, targeted follow-up, shortlist, outcome, export, and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page, 'repair');
  await check(page);
  const card = page
    .locator('.result-card')
    .filter({ has: page.getByRole('heading', { name: 'Thread & Trail' }) });
  await expect(card).toContainText('Needs clarification');
  await expect(card).toContainText('starting estimate');
  await card.getByRole('button', { name: 'View evidence' }).click();
  await expect(page.getByRole('dialog')).toContainText('Backpack zipper repairs start at $35');
  await page.getByRole('button', { name: 'Source conversations' }).click();
  await expect(page.getByRole('dialog')).toContainText('Recipient');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Preview one-question follow-up' }).click();
  await page.getByRole('button', { name: 'Load fictional follow-up' }).click();
  await expect(card).toContainText('Meets checked requirements');
  await card.getByRole('button', { name: 'Save to shortlist' }).click();
  await page.getByRole('button', { name: 'Confirm my update' }).click();
  await expect(card).toContainText('You marked this selected');
  await card.getByRole('button', { name: 'Confirm arrangement' }).click();
  await page.getByRole('button', { name: 'Confirm my update' }).click();
  await expect(card).toContainText('You marked this arrangement confirmed');
  await page.reload();
  await expect(page.locator('.result-card')).toHaveCount(3);
  await expect(card).toContainText('Meets checked requirements');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/readycheck-.*-v1\.txt/);
  await page.screenshot({ path: 'artifacts/repair-verified.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('rental: exact alternate fails, deposit stays separate, a valid option passes', async ({
  page,
}) => {
  await start(page, 'rental');
  await check(page);
  await expect(
    page.locator('.result-card').filter({ hasText: 'Brightside Rentals' }),
  ).toContainText('Meets checked requirements');
  await expect(page.locator('.result-card').filter({ hasText: 'City AV Supply' })).toContainText(
    'Does not meet requirements',
  );
  await expect(page.locator('.requirements-panel')).toContainText('Refundable deposit');
});
test('venue: honest no-confirmed-option result and immutable revision history', async ({
  page,
}) => {
  await start(page, 'venue');
  await check(page);
  await expect(page.locator('.comparison-summary')).toContainText('No confirmed match yet');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Total venue fee', exact: true }).fill('300');
  await expect(
    page.getByRole('heading', { name: 'Save your revised requirements.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByLabel('View revision')).toHaveValue('2');
  await page.getByLabel('View revision').selectOption('1');
  await expect(page.locator('.requirements-panel')).toContainText('Up to $200');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});
test('360px mobile: keyboard flow, dialog focus, no horizontal page overflow, deletion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await start(page, 'repair');
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'ReadyCheck home' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0);
  await check(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.result-card').first().getByRole('button', { name: 'View evidence' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.screenshot({ path: 'artifacts/evidence-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/mobile-verified.png', fullPage: true });
  await page.getByRole('button', { name: 'Delete this check' }).click();
  await page.getByRole('button', { name: 'Delete check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A little certainty. A lot less calling.' }),
  ).toBeVisible();
});
test('account creation keeps the guest check and live calling stays blocked', async ({ page }) => {
  await start(page, 'repair');
  await page.getByRole('button', { name: 'Y Your workspace Guest · Create an account' }).click();
  await page.getByLabel('Your name').fill('Demo Builder');
  await page.getByLabel('Email', { exact: true }).fill(`browser-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-browser-test-phrase-42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: /D Demo Builder Signed in/ })).toBeVisible();
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Live calling is switched off');
  await expect(page.getByRole('button', { name: 'Start a controlled live check' })).toBeDisabled();
});

test('adding a candidate preserves the first response', async ({ page }) => {
  await start(page, 'repair');
  await page.getByRole('checkbox', { name: /The Mending Room/ }).uncheck();
  await page.getByRole('checkbox', { name: /Everyday Repair Co/ }).uncheck();
  await page.getByRole('button', { name: 'Preview inquiry' }).click();
  await page.getByRole('button', { name: 'Load fictional responses' }).click();
  await expect(page.locator('.result-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add a candidate', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: /The Mending Room/ })
    .check();
  await page.getByRole('button', { name: 'Preview additional inquiry' }).click();
  await page.getByRole('button', { name: 'Load fictional responses' }).click();
  await expect(page.locator('.result-card')).toHaveCount(2);
  await expect(page.locator('.result-card').filter({ hasText: 'Thread & Trail' })).toContainText(
    'starting estimate',
  );
});

test('a failed save preserves the draft through reload', async ({ page }) => {
  await start(page, 'repair');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Total budget', exact: true }).fill('45');
  await page.route('**/api/cases/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Test save failure' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByRole('alert')).toContainText('Test save failure');
  await page.unroute('**/api/cases/*');
  await page.reload();
  await expect(page.locator('.requirements-panel')).toContainText('Up to $45');
  await expect(page.getByRole('button', { name: 'Save new revision' })).toBeVisible();
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByLabel('View revision')).toHaveValue('2');
});

test('new-check onboarding creates a purchase and saves an explicitly accepted alternative', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New check', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Step 1 of 2');
  await page.getByLabel('What do you need to check?').selectOption('rental');
  await page.getByLabel('Purchase or rental').selectOption('purchase');
  await expect(page.getByRole('radio', { name: /Make a real inquiry/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Review requirements' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Purchase total', exact: true })).toHaveValue(
    '1200',
  );
  await expect(page.getByRole('dialog')).not.toContainText('Refundable deposit');
  await page.getByRole('button', { name: 'Create check', exact: true }).click();
  await check(page);
  const alternate = page.locator('.result-card').filter({ hasText: 'City AV Supply' });
  await expect(alternate).toContainText('Does not meet requirements');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Accept another model' }).click();
  await expect(page.getByRole('button', { name: 'Save new revision' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Accepted alternative 1' }).fill('Epson EX3280');
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(alternate).toContainText('Meets checked requirements');
  await page.reload();
  await expect(page.locator('.requirements-panel')).toContainText('also accepted: Epson EX3280');
  await expect(alternate).toContainText('Meets checked requirements');
  await page.getByLabel('View revision').selectOption('1');
  await expect(alternate).toContainText('Does not meet requirements');
});

test('360px onboarding preserves reviewed edits when going back and after a failed create', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a check', exact: true }).click();
  await page.getByRole('button', { name: 'Review requirements' }).click();
  await page.getByRole('spinbutton', { name: 'Total budget', exact: true }).fill('45');
  await page.getByRole('button', { name: 'Back to starting point' }).click();
  await page.getByRole('button', { name: 'Review requirements' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Total budget', exact: true })).toHaveValue(
    '45',
  );
  await page.route('**/api/cases', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Could not save this check. Try again.' }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Create check', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Could not save this check',
  );
  await expect(page.getByRole('spinbutton', { name: 'Total budget', exact: true })).toHaveValue(
    '45',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/onboarding-mobile.png', fullPage: true });
  await page.unroute('**/api/cases');
  await page.getByRole('button', { name: 'Create check', exact: true }).click();
  await expect(page.locator('.requirements-panel')).toContainText('Up to $45');
});

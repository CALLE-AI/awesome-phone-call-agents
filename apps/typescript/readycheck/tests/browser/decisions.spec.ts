import { test, expect, type Page } from '@playwright/test';
async function comparison(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Find a repair service The right repair/ }).click();
  await page.getByRole('button', { name: 'Preview inquiry', exact: true }).click();
  await page.getByRole('button', { name: 'Load fictional responses' }).click();
  await expect(page.locator('.result-card')).toHaveCount(3);
}

test('budget exploration is reversible, interactive, scoped and saved as a new revision', async ({
  page,
}) => {
  await comparison(page);
  const guide = page.getByRole('region', { name: 'Ways forward' });
  await expect(guide).toContainText('$40 → $45');
  const recordBefore = await page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('case');
    return (await fetch('/api/cases/' + id)).json();
  });
  await guide.getByRole('button', { name: 'Preview limit change' }).click();
  let dialog = page.getByRole('dialog', { name: 'Preview a limit change' });
  await expect(dialog).toContainText('Would meet the checked requirements');
  await dialog.getByRole('spinbutton', { name: 'Total budget in USD' }).fill('44');
  await expect(dialog).toContainText('Still does not meet every requirement');
  await expect(dialog.getByRole('button', { name: 'Apply as new revision' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Keep original requirements' }).click();
  await expect(page.getByLabel('View revision')).toHaveValue('1');
  await guide.getByRole('button', { name: 'Preview limit change' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Apply as new revision' }).click();
  await expect(page.getByLabel('View revision')).toHaveValue('2');
  const card = page
    .locator('.result-card')
    .filter({ has: page.getByRole('heading', { name: 'Everyday Repair Co.' }) });
  await expect(card).toContainText('Meets checked requirements');
  const recordAfter = await page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('case');
    return (await fetch('/api/cases/' + id)).json();
  });
  expect(recordAfter.revisions[0]).toEqual(recordBefore.revisions[0]);
  expect(recordAfter.revisions[1].results).toEqual(recordBefore.revisions[0].results);
  expect(recordAfter.plans).toHaveLength(0);
  await page.reload();
  await expect(page.getByLabel('View revision')).toHaveValue('2');
  await page.getByLabel('View revision').selectOption('1');
  await expect(page.locator('.requirements-panel')).toContainText('Up to $40');
  await expect(card).toContainText('Does not meet requirements');
});

test('one-question follow-up sends only its recommended field and does not repeat a failed service inquiry', async ({
  page,
}) => {
  await comparison(page);
  const guide = page.getByRole('region', { name: 'Ways forward' });
  await expect(guide.getByRole('heading', { name: 'The one question left' })).toBeVisible();
  const failed = page
    .locator('.result-card')
    .filter({ has: page.getByRole('heading', { name: 'The Mending Room' }) });
  await expect(failed.getByRole('button', { name: 'Preview one-question follow-up' })).toHaveCount(
    0,
  );
  await guide.getByRole('button', { name: 'Preview one-question follow-up' }).click();
  await expect(page.getByRole('dialog').locator('.question-list li')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('Total budget');
  const request = page.waitForRequest((r) => r.url().endsWith('/sample-followup'));
  await page.getByRole('button', { name: 'Load fictional follow-up' }).click();
  expect((await request).postDataJSON().focusField).toBe('budget');
  await expect(
    page
      .locator('.result-card')
      .filter({ has: page.getByRole('heading', { name: 'Thread & Trail' }) }),
  ).toContainText('Meets checked requirements');
  await expect(page.getByRole('region', { name: 'Ways forward' })).toHaveCount(0);
});

test('mobile budget preview preserves the applied draft when saving fails', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await comparison(page);
  await page
    .getByRole('region', { name: 'Ways forward' })
    .getByRole('button', { name: 'Preview limit change' })
    .click();
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.route('**/api/cases/*', async (route) => {
    if (route.request().method() === 'PATCH')
      return route.fulfill({ status: 503, json: { error: 'Simulated save interruption' } });
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Apply as new revision' }).click();
  await expect(page.getByText('Simulated save interruption', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Save your revised requirements.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Total budget', exact: true })).toHaveValue(
    '45',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an excluded price interpretation is visible without presenting it as a confirmed price', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await comparison(page);
  const id = new URL(page.url()).searchParams.get('case');
  await page.route(`**/api/cases/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const candidate = body.revisions[0].results[0];
    candidate.facts = candidate.facts.filter((fact: { field: string }) => fact.field !== 'budget');
    candidate.extractionWarnings = [
      'A price interpretation did not match its explicit dollar quote and was excluded. Review the transcript before relying on that amount.',
    ];
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const card = page
    .locator('.result-card')
    .filter({ has: page.getByRole('heading', { name: 'Thread & Trail' }) });
  await expect(card).toContainText('Needs clarification');
  await card.getByRole('button', { name: 'View evidence' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Review extraction warnings',
  );
  expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

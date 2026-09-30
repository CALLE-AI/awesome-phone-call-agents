import { test, expect } from '@playwright/test';

test('connection setup is usable on mobile and distinguishes key presence from calling access', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your connection' });
  await expect(
    dialog.getByRole('list', { name: 'Calling setup checklist' }).getByRole('listitem'),
  ).toHaveCount(5);
  await expect(dialog.getByRole('button', { name: 'Check existing-call access' })).toBeDisabled();
  await expect(dialog).toContainText('Agent CLI sign-in and a saved API key do not verify');
  await dialog.getByText('Server setup instructions', { exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'Get a CALL-E API key' })).toHaveAttribute(
    'href',
    'https://dashboard.heycall-e.com/account/api-keys',
  );
  await dialog.getByRole('button', { name: 'Refresh setup' }).click();
  await expect(dialog.getByRole('button', { name: 'Refresh setup' })).toBeEnabled();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('connection UI preserves an inconclusive read and reports cooldown errors without claiming calling success', async ({
  page,
}) => {
  let result: object | null = null;
  let checks = 0;
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    session.user.guest = false;
    session.connection.authorized = true;
    session.connection.readAccess = result;
    session.connection.checks.find((check: { id: string }) => check.id === 'credential').ready =
      true;
    await route.fulfill({ json: session });
  });
  await page.route('**/api/connection/verify', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({});
    checks++;
    if (checks > 1)
      return route.fulfill({
        status: 429,
        json: { error: 'Wait one minute between access checks.' },
      });
    result = {
      status: 'not_found',
      checkedAt: '2026-09-09T18:00:00Z',
      message:
        'The selected call was not accessible through this API key. Key validity is still unverified.',
    };
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Check existing-call access' }).click();
  await expect(dialog).toContainText('Key validity is still unverified.');
  await expect(dialog.getByText('Last read succeeded')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check existing-call access' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Wait one minute');
  await expect(dialog).toContainText('Key validity is still unverified.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Key validity is still unverified.');
});

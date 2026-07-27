import { test, expect } from '@playwright/test';

test('has title matching app name', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/CALL-E OAuth Login/);
});

test('shows disconnected status and enabled login button on load', async ({ page }) => {
  await page.goto('/');

  const loginBtn = page.locator('#login-btn');
  await expect(loginBtn).toBeVisible();
  await expect(loginBtn).toBeEnabled();

  const statusText = page.locator('#status-text');
  await expect(statusText).toHaveText('Disconnected');
});

test('error container is hidden on initial load', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#error-container')).toBeHidden();
});

test('content section is hidden before login', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#content')).toBeHidden();
});

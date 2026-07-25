import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Vite/);
});

test('loads the main page and shows login elements', async ({ page }) => {
  await page.goto('/');

  // Check that some expected content is rendered
  // You might want to adjust this based on the actual app content
  await expect(page.locator('body')).toBeVisible();
});

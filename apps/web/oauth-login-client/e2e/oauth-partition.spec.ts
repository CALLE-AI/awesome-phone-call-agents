/**
 * OAuth credential namespace / partitioning tests.
 */
import { test, expect } from '@playwright/test';

test.describe('OAuth credential namespace partitioning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('tokens from server A are not visible to a provider for server B', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      if (!Provider) throw new Error("Provider not exposed");
      const serverA = 'https://server-a.example.com/api/v1/mcp';
      const serverB = 'https://server-b.example.com/api/v1/mcp';

      const providerA = await Provider.create('http://localhost', {}, serverA);
      providerA.saveTokens({ access_token: 'TOKEN_A', token_type: 'Bearer' });

      const providerB = await Provider.create('http://localhost', {}, serverB);
      const tokenB = providerB.tokens();
      const tokenA = providerA.tokens();

      return { tokenA, tokenB };
    });

    expect(result.tokenA?.access_token).toBe('TOKEN_A');
    expect(result.tokenB).toBeUndefined();
  });

  test('long origins do not collide (collision resistance)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const base = 'https://very-long-domain-name-that-exceeds-32-characters.example.com';
      const serverA = base + '/path-A';
      const serverB = base + '/path-B';

      const providerA = await Provider.create('http://localhost', {}, serverA);
      providerA.saveTokens({ access_token: 'TOKEN_A', token_type: 'Bearer' });

      const providerB = await Provider.create('http://localhost', {}, serverB);
      providerB.saveTokens({ access_token: 'TOKEN_B', token_type: 'Bearer' });

      const tokenA = providerA.tokens();
      const tokenB = providerB.tokens();

      return { tokenA, tokenB };
    });

    expect(result.tokenA?.access_token).toBe('TOKEN_A');
    expect(result.tokenB?.access_token).toBe('TOKEN_B');
  });

  test('invalidateCredentials clears all tokens', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const server = 'https://my-server.example.com';
      const provider = await Provider.create('http://localhost', {}, server);
      provider.saveTokens({ access_token: 'T', token_type: 'Bearer' });
      provider.saveClientInformation({ client_id: 'C' });

      provider.invalidateCredentials();
      return {
        tokens: provider.tokens(),
        clientInfo: provider.clientInformation()
      };
    });

    expect(result.tokens).toBeUndefined();
    expect(result.clientInfo).toBeUndefined();
  });

  test('logout button resets UI and clears credentials', async ({ page }) => {
    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const SERVER_URL = (window as any).__SERVER_URL;
      const provider = await Provider.create('http://localhost', {}, SERVER_URL);
      (window as any).__setActiveProvider(provider);
      provider.saveTokens({ access_token: 'T', token_type: 'Bearer' });

      document.getElementById('status-dot')!.classList.add('connected');
      document.getElementById('status-text')!.textContent = 'Connected';
      document.getElementById('content')!.classList.remove('hidden');
      document.getElementById('login-btn')!.classList.add('hidden');
      document.getElementById('logout-btn')!.classList.remove('hidden');
    });

    await expect(page.locator('#logout-btn')).toBeVisible();
    await page.click('#logout-btn');

    await expect(page.locator('#login-btn')).toBeVisible();
    await expect(page.locator('#logout-btn')).toBeHidden();

    // Check credentials cleared
    const hasTokens = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const SERVER_URL = (window as any).__SERVER_URL;
      const provider = await Provider.create('http://localhost', {}, SERVER_URL);
      return !!provider.tokens();
    });
    expect(hasTokens).toBe(false);
  });

  test('OAuth error callback clears state and shows error', async ({ page }) => {
    // Generate state so we have a valid state to pass back
    const state = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const SERVER_URL = (window as any).__SERVER_URL;
      const provider = await Provider.create('http://localhost:5173/', {}, SERVER_URL);
      return provider.state();
    });

    // Go to error callback URL
    await page.goto(`/?error=invalid_grant&state=${state}`);

    // UI should show error
    await expect(page.locator('#error-container')).toBeVisible();
    await expect(page.locator('#error-text')).toContainText('OAuth Error: invalid_grant');

    // State should be consumed
    const stateConsumed = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const SERVER_URL = (window as any).__SERVER_URL;
      const provider = await Provider.create('http://localhost:5173/', {}, SERVER_URL);
      let found = false;
      for (let i = 0; i < sessionStorage.length; i++) {
        if (sessionStorage.key(i)?.endsWith('_state')) found = true;
      }
      return !found;
    });
    expect(stateConsumed).toBe(true);
  });

  test('cross-tab regression coverage', async ({ browser }) => {
    // Open tab 1
    const context = await browser.newContext();
    const page1 = await context.newPage();
    await page1.goto('/');

    // Set token in tab 1
    await page1.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('http://localhost', {}, 'https://server.example.com');
      provider.saveTokens({ access_token: 'TAB1_TOKEN', token_type: 'Bearer' });
    });

    // Open tab 2 in same context (same browser session)
    const page2 = await context.newPage();
    await page2.goto('/');

    // Since sessionStorage is per-tab, tab 2 should NOT see tab 1's tokens
    const tab2HasToken = await page2.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('http://localhost', {}, 'https://server.example.com');
      return provider.tokens()?.access_token === 'TAB1_TOKEN';
    });

    expect(tab2HasToken).toBe(false);
  });
});

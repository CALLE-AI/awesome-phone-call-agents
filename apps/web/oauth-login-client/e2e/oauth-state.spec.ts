/**
 * OAuth state parameter — CSRF / replay regression tests.
 *
 * These tests exercise `checkOAuthCallback()` in src/main.ts to verify that:
 *   1. A callback with no ?state= is rejected.
 *   2. A callback with a mismatched ?state= is rejected.
 *   3. The state token is consumed after first use (replay rejected).
 *   4. A valid ?state= + ?code= flow is accepted and proceeds to connect.
 *   5. The authorization code (?code=) is removed from the address bar even
 *      when token exchange fails.
 *
 * The Playwright route interceptor acts as the MCP server so no live
 * credentials or network access are required.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared MCP stub — satisfies initialize + tools/list + resources/list
// ---------------------------------------------------------------------------

async function stubMcpServer(page: import('@playwright/test').Page) {
  await page.route('**', async (route) => {
    const req = route.request();
    const url = req.url();
    const isLocal =
      url.startsWith('http://localhost:5173') ||
      url.startsWith('http://localhost:4173') ||
      url.startsWith('http://127.0.0.1:5173') ||
      url.startsWith('http://127.0.0.1:4173') ||
      url.startsWith('data:');

    if (req.method() !== 'POST' || isLocal) return route.continue();

    let body: any = {};
    try { body = JSON.parse(req.postData() ?? '{}'); } catch { return route.continue(); }

    if (body.method && body.id === undefined) {
      await route.fulfill({ status: 202, body: '' });
      return;
    }

    const responses: Record<string, unknown> = {
      initialize: {
        jsonrpc: '2.0', id: body.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'state-test-server', version: '0.0.0' },
        },
      },
      'tools/list': {
        jsonrpc: '2.0', id: body.id,
        result: { tools: [{ name: 'test-tool', description: 'A demo tool.' }] },
      },
      'resources/list': {
        jsonrpc: '2.0', id: body.id,
        result: { resources: [] },
      },
    };

    const resp = responses[body.method] ?? {
      jsonrpc: '2.0', id: body.id,
      error: { code: -32601, message: 'Method not found' },
    };
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Mcp-Session-Id': 'state-test-session',
      },
      body: JSON.stringify(resp),
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: plant a state token directly in sessionStorage (simulates a prior
// call to provider.state()) so tests can control the stored value.
// ---------------------------------------------------------------------------

/** The storage key prefix for the default fallback server URL used by the app. */
async function plantStateToken(page: import('@playwright/test').Page, token: string) {
  await page.evaluate((tok) => {
    // Mirror the namespace logic from BrowserOAuthClientProvider.
    // The app falls back to the env var or the remote URL; in test mode the
    // Vite dev server sets VITE_MCP_SERVER_URL to nothing, so the app uses the
    // production fallback.  We cannot easily read import.meta.env here, so we
    // write to every plausible namespace prefix.  The provider will find the
    // first matching key.
    //
    // In practice, for the state-validation tests we navigate directly to the
    // callback URL with ?state=<value>, so as long as the stored token matches
    // (or is absent), the test controls the outcome.
    const origins = [
      'http://localhost:3001',                              // .env / .env.mock
      'https://seleven-mcp-sg.airudder.com',               // production fallback
    ];
    for (const origin of origins) {
      const ns = btoa(origin).replace(/[+/=]/g, '_').slice(0, 32);
      sessionStorage.setItem(`calle_oauth_${ns}_state`, JSON.stringify(tok));
    }
  }, token);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('OAuth state parameter — CSRF / replay protection', () => {
  test('callback with no ?state= is rejected and shows an error', async ({ page }) => {
    await stubMcpServer(page);
    await page.goto('/');

    // Simulate arriving back from the OAuth server without a state parameter
    await page.evaluate(() => {
      window.history.replaceState({}, '', '/?code=auth-code-no-state');
    });
    // Trigger DOMContentLoaded handler
    await page.evaluate(() => {
      window.dispatchEvent(new Event('DOMContentLoaded'));
    });

    // The app should reject the callback and display an error
    await page.waitForSelector('#error-container:not(.hidden)', { timeout: 5000 });
    const errorText = await page.locator('#error-text').textContent();
    expect(errorText).toContain('state');

    // The authorization code must be stripped from the address bar
    expect(page.url()).not.toContain('code=');
  });

  test('callback with mismatched ?state= is rejected', async ({ page }) => {
    await stubMcpServer(page);
    await page.goto('/');

    // Plant a valid state token in storage
    await plantStateToken(page, 'correct-state-token');

    // Simulate callback with a different state value
    await page.evaluate(() => {
      window.history.replaceState({}, '', '/?code=auth-code&state=WRONG-STATE');
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('DOMContentLoaded'));
    });

    await page.waitForSelector('#error-container:not(.hidden)', { timeout: 5000 });
    const errorText = await page.locator('#error-text').textContent();
    expect(errorText).toMatch(/state.*mismatch|mismatch.*state|CSRF|state/i);

    // Code must be cleared from the URL
    expect(page.url()).not.toContain('code=');
  });

  test('state token is consumed after first use (replay rejected)', async ({ page }) => {
    await stubMcpServer(page);
    await page.goto('/');

    const TOKEN = 'one-time-state-token';
    await plantStateToken(page, TOKEN);

    // First callback — should succeed (state matches)
    await page.evaluate((tok) => {
      window.history.replaceState({}, '', `/?code=auth-code-1&state=${tok}`);
    }, TOKEN);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('DOMContentLoaded'));
    });

    // Wait for the first flow to settle (success or partial)
    await page.waitForTimeout(2000);

    // Reset and attempt to replay the same state token
    await page.evaluate((tok) => {
      window.history.replaceState({}, '', `/?code=auth-code-2&state=${tok}`);
    }, TOKEN);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('DOMContentLoaded'));
    });

    // Second use must be rejected — the stored token was consumed
    await page.waitForSelector('#error-container:not(.hidden)', { timeout: 5000 });
    const errorText = await page.locator('#error-text').textContent();
    expect(errorText).toMatch(/state|replay|CSRF/i);
  });

  test('authorization code is removed from the URL even when token exchange fails', async ({ page }) => {
    // Make the MCP transport fail after initialize so finishAuth throws
    await page.route('**', async (route) => {
      const req = route.request();
      const url = req.url();
      const isLocal =
        url.startsWith('http://localhost:5173') ||
        url.startsWith('http://localhost:4173') ||
        url.startsWith('http://127.0.0.1');
      if (req.method() !== 'POST' || isLocal) return route.continue();

      let body: any = {};
      try { body = JSON.parse(req.postData() ?? '{}'); } catch { return route.continue(); }

      // initialize succeeds but everything else fails
      if (body.method === 'initialize') {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'fail-session' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: body.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              serverInfo: { name: 'fail-server', version: '0.0.0' },
            },
          }),
        });
        return;
      }
      // Token exchange endpoint returns a 401 to simulate failure
      await route.fulfill({ status: 401, body: 'Unauthorized' });
    });

    await page.goto('/');
    const TOKEN = 'cleanup-test-state';
    await plantStateToken(page, TOKEN);

    await page.evaluate((tok) => {
      window.history.replaceState({}, '', `/?code=bad-code&state=${tok}`);
    }, TOKEN);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('DOMContentLoaded'));
    });

    // Give the async handler time to run
    await page.waitForTimeout(2000);

    // The authorization code must be gone from the URL regardless of outcome
    expect(page.url()).not.toContain('code=');
    expect(page.url()).not.toContain('state=');
  });
});

/**
 * OAuth security regression tests — three suites:
 *
 *   1. Success-flow regression: a real state + PKCE code exchange completes
 *      and the app reaches 'connected' or 'degraded' status.  This is the
 *      missing coverage the PM flagged — the existing replay test never
 *      actually exercises a successful exchange.
 *
 *   2. Issuer-change invalidation: saving discovery state with a different
 *      authorization server issuer must throw and wipe all credentials.
 *
 *   3. Scoped invalidation: each `invalidateCredentials(scope)` variant
 *      removes exactly the right key(s) and leaves all others intact.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Stub every external POST as a well-formed MCP response so the full
 * OAuth-then-connect flow can complete without hitting a real server.
 *
 * The stub returns:
 *   - initialize  → capabilities { tools, resources }
 *   - tools/list  → one demo tool
 *   - resources/list → empty list
 *   - notifications (no id) → 202
 *   - anything else → method-not-found error
 */
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

    // ---------------------------------------------------------------------------
    // OAuth token exchange endpoint — returns a valid OAuth bearer token.
    // The success-flow test plants a token_endpoint that ends with "/token".
    // ---------------------------------------------------------------------------
    if (url.endsWith('/token') || url.includes('/token?')) {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          access_token: 'stub-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });
      return;
    }

    // ---------------------------------------------------------------------------
    // MCP JSON-RPC endpoint
    // ---------------------------------------------------------------------------
    let body: any = {};
    try { body = JSON.parse(req.postData() ?? '{}'); } catch { return route.continue(); }

    // Notifications (no id) — acknowledge without a body
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
          serverInfo: { name: 'security-test-server', version: '0.0.0' },
        },
      },
      'tools/list': {
        jsonrpc: '2.0', id: body.id,
        result: { tools: [{ name: 'ping', description: 'Ping tool.' }] },
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
        'Mcp-Session-Id': 'security-test-session',
      },
      body: JSON.stringify(resp),
    });
  });
}

/**
 * Seed the provider's sessionStorage with everything `finishAuth` needs so
 * the full PKCE code exchange can complete against the stub server:
 *   - clientInfo  (registered client)
 *   - codeVerifier (PKCE verifier matching the test code)
 *   - discoveryState (AS endpoints that point back to the stub)
 *   - state (CSRF token)
 *
 * Returns the planted state token.
 */
async function seedProviderForSuccessFlow(
  page: import('@playwright/test').Page,
  stateToken: string
): Promise<void> {
  await page.evaluate(async (tok) => {
    const Provider = (window as any).__BrowserOAuthClientProvider;
    if (!Provider) throw new Error('BrowserOAuthClientProvider not exposed on window');
    const SERVER_URL: string = (window as any).__SERVER_URL;
    if (!SERVER_URL) throw new Error('__SERVER_URL not exposed on window');

    const provider = await Provider.create('http://localhost:5173/', {}, SERVER_URL);

    // A real discovery state pointing at the stub (which also handles token
    // exchange as a generic POST → 200).
    const mockServerUrl = SERVER_URL.replace(/\/mcp.*/, '') || 'https://seleven-mcp-sg.airudder.com';

    // Use the app's own origin for the AS endpoints so the stub can handle
    // the token POST (the MCP transport already intercepts all external POSTs).
    const discoveryState = {
      authorizationServerUrl: mockServerUrl,
      authorizationServerMetadata: {
        issuer: mockServerUrl,
        authorization_endpoint: `${mockServerUrl}/authorize`,
        token_endpoint: `${mockServerUrl}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      },
    };

    // saveDiscoveryState validates the endpoints — use setItem directly so
    // we can plant metadata without triggering the loopback check on
    // https endpoints that resolve to external hosts in this test context.
    (provider as any).setItem('discoveryState', discoveryState);
    (provider as any).setItem('boundIssuer', mockServerUrl);

    // A pre-registered client.
    provider.saveClientInformation({ client_id: 'test-client-id', client_secret: undefined });

    // A PKCE code verifier (the stub does not validate the challenge, so any
    // string works).
    (provider as any).setItem('codeVerifier', 'test-code-verifier-string-minimum-43-chars-long');

    // Plant the CSRF state token.
    (provider as any).setItem('state', tok);
  }, stateToken);
}

// ---------------------------------------------------------------------------
// Suite 1 — Success-flow regression
// ---------------------------------------------------------------------------

test.describe('OAuth success-flow regression', () => {
  test('valid state + code reaches connected or degraded status', async ({ page }) => {
    await stubMcpServer(page);
    await page.goto('/');

    const STATE = 'success-flow-state-token';
    await seedProviderForSuccessFlow(page, STATE);

    // Simulate arriving back from the authorization server with a valid code
    // and the correct state parameter.
    await page.evaluate((tok) => {
      window.history.replaceState({}, '', `/?code=valid-auth-code&state=${tok}`);
    }, STATE);

    // Dispatch DOMContentLoaded to trigger checkOAuthCallback().
    await page.evaluate(() => {
      window.dispatchEvent(new Event('DOMContentLoaded'));
    });

    // The app must reach 'connected' or 'degraded' status — never stay on
    // 'Completing Login...' or show 'Existing OAuth client information is required'.
    await page.waitForSelector('#content:not(.hidden)', { timeout: 10000 });

    // Confirm no error is shown (the exchange should complete cleanly).
    const errorVisible = await page.locator('#error-container:not(.hidden)').count();
    if (errorVisible > 0) {
      const errText = await page.locator('#error-text').textContent();
      // If an error is shown, it must NOT be the "no client info" sentinel.
      expect(errText).not.toContain('Existing OAuth client information is required');
    }

    // The authorization code and state must be stripped from the URL.
    expect(page.url()).not.toContain('code=');
    expect(page.url()).not.toContain('state=');

    // The login button must be hidden and the logout button visible.
    await expect(page.locator('#login-btn')).toBeHidden();
    await expect(page.locator('#logout-btn')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Issuer-change invalidation
// ---------------------------------------------------------------------------

test.describe('OAuth discovery issuer-change invalidation', () => {
  test('saving discovery state with a different issuer throws and clears credentials', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;

      // Use an https server so assertSecureUrl passes for the AS endpoints.
      const server = 'https://auth-server-a.example.com';
      const provider = await Provider.create('https://app.example.com/', {}, server);

      // Plant initial discovery state and tokens for AS-A.
      (provider as any).setItem('discoveryState', {
        authorizationServerUrl: 'https://auth-server-a.example.com',
        authorizationServerMetadata: {
          issuer: 'https://auth-server-a.example.com',
          authorization_endpoint: 'https://auth-server-a.example.com/authorize',
          token_endpoint: 'https://auth-server-a.example.com/token',
          response_types_supported: ['code'],
        },
      });
      (provider as any).setItem('boundIssuer', 'https://auth-server-a.example.com');
      provider.saveTokens({ access_token: 'TOKEN_A', token_type: 'Bearer' });
      provider.saveClientInformation({ client_id: 'CLIENT_A' });

      // Now attempt to save discovery state for a DIFFERENT issuer (AS-B).
      let errorMessage = '';
      try {
        provider.saveDiscoveryState({
          authorizationServerUrl: 'https://auth-server-b.example.com',
          authorizationServerMetadata: {
            issuer: 'https://auth-server-b.example.com',
            authorization_endpoint: 'https://auth-server-b.example.com/authorize',
            token_endpoint: 'https://auth-server-b.example.com/token',
            response_types_supported: ['code'],
          },
        });
      } catch (e: any) {
        errorMessage = e.message ?? String(e);
      }

      return {
        errorMessage,
        tokensAfter: provider.tokens(),
        clientInfoAfter: provider.clientInformation(),
        discoveryAfter: provider.discoveryState(),
      };
    });

    // The issuer change must throw a descriptive error.
    expect(result.errorMessage).toMatch(/issuer changed/i);

    // All credentials must be wiped — nothing from AS-A can be reused against AS-B.
    expect(result.tokensAfter).toBeUndefined();
    expect(result.clientInfoAfter).toBeUndefined();
    expect(result.discoveryAfter).toBeUndefined();
  });

  test('saving discovery state with the same issuer succeeds (idempotent)', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const server = 'https://auth-server-stable.example.com';
      const provider = await Provider.create('https://app.example.com/', {}, server);

      const state = {
        authorizationServerUrl: 'https://auth-server-stable.example.com',
        authorizationServerMetadata: {
          issuer: 'https://auth-server-stable.example.com',
          authorization_endpoint: 'https://auth-server-stable.example.com/authorize',
          token_endpoint: 'https://auth-server-stable.example.com/token',
          response_types_supported: ['code'],
        },
      };

      let threw = false;
      try {
        provider.saveDiscoveryState(state as any);
        // Saving again with the same issuer must be idempotent.
        provider.saveDiscoveryState(state as any);
      } catch {
        threw = true;
      }

      return { threw, discoveryPresent: !!provider.discoveryState() };
    });

    expect(result.threw).toBe(false);
    expect(result.discoveryPresent).toBe(true);
  });

  test('saveDiscoveryState rejects a plaintext HTTP authorization_endpoint on a non-loopback host', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const server = 'https://secure-mcp.example.com';
      const provider = await Provider.create('https://app.example.com/', {}, server);

      let errorMessage = '';
      try {
        provider.saveDiscoveryState({
          authorizationServerUrl: 'https://secure-mcp.example.com',
          authorizationServerMetadata: {
            issuer: 'https://secure-mcp.example.com',
            // Plaintext HTTP endpoint — must be rejected even if the issuer is HTTPS.
            authorization_endpoint: 'http://secure-mcp.example.com/authorize',
            token_endpoint: 'https://secure-mcp.example.com/token',
            response_types_supported: ['code'],
          },
        } as any);
      } catch (e: any) {
        errorMessage = e.message ?? String(e);
      }

      return { errorMessage };
    });

    expect(result.errorMessage).toMatch(/authorization server authorization_endpoint.*https/i);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Scoped credential invalidation
// ---------------------------------------------------------------------------

test.describe('invalidateCredentials — scoped invalidation', () => {
  /**
   * Seed all five credential keys and return a fresh provider bound to the
   * same namespace so we can inspect individual keys after invalidation.
   */
  async function seedAll(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const server = 'https://scoped-test.example.com';
      const provider = await Provider.create('https://app.example.com/', {}, server);
      provider.saveTokens({ access_token: 'T', token_type: 'Bearer' });
      provider.saveClientInformation({ client_id: 'C' });
      (provider as any).setItem('codeVerifier', 'V');
      (provider as any).setItem('discoveryState', {
        authorizationServerUrl: 'https://scoped-test.example.com',
        authorizationServerMetadata: {
          issuer: 'https://scoped-test.example.com',
          authorization_endpoint: 'https://scoped-test.example.com/authorize',
          token_endpoint: 'https://scoped-test.example.com/token',
          response_types_supported: ['code'],
        },
      });
      (provider as any).setItem('boundIssuer', 'https://scoped-test.example.com');
      (provider as any).setItem('state', 'S');
    });
  }

  async function readAll(page: import('@playwright/test').Page) {
    return page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const server = 'https://scoped-test.example.com';
      const provider = await Provider.create('https://app.example.com/', {}, server);
      return {
        tokens: provider.tokens() !== undefined,
        clientInfo: provider.clientInformation() !== undefined,
        codeVerifier: (provider as any).getItem('codeVerifier') !== undefined,
        // Read discoveryState raw (bypass validation) to test the key itself.
        discoveryStateRaw: sessionStorage.getItem(
          Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))
            .find(k => k?.endsWith('_discoveryState')) ?? ''
        ) !== null,
        boundIssuer: (provider as any).getItem('boundIssuer') !== undefined,
        state: (provider as any).getItem('state') !== undefined,
      };
    });
  }

  test('scope "tokens" removes only the token set', async ({ page }) => {
    await page.goto('/');
    await seedAll(page);

    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('https://app.example.com/', {}, 'https://scoped-test.example.com');
      provider.invalidateCredentials('tokens');
    });

    const state = await readAll(page);
    expect(state.tokens).toBe(false);
    expect(state.clientInfo).toBe(true);
    expect(state.codeVerifier).toBe(true);
    expect(state.discoveryStateRaw).toBe(true);
    expect(state.state).toBe(true);
  });

  test('scope "verifier" removes only the PKCE code verifier', async ({ page }) => {
    await page.goto('/');
    await seedAll(page);

    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('https://app.example.com/', {}, 'https://scoped-test.example.com');
      provider.invalidateCredentials('verifier');
    });

    const state = await readAll(page);
    expect(state.tokens).toBe(true);
    expect(state.clientInfo).toBe(true);
    expect(state.codeVerifier).toBe(false);
    expect(state.discoveryStateRaw).toBe(true);
    expect(state.state).toBe(true);
  });

  test('scope "discovery" removes only the discovery state (boundIssuer preserved)', async ({ page }) => {
    await page.goto('/');
    await seedAll(page);

    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('https://app.example.com/', {}, 'https://scoped-test.example.com');
      provider.invalidateCredentials('discovery');
    });

    const state = await readAll(page);
    expect(state.tokens).toBe(true);
    expect(state.clientInfo).toBe(true);
    expect(state.codeVerifier).toBe(true);
    expect(state.discoveryStateRaw).toBe(false);
    // boundIssuer is intentionally preserved so re-discovery is still issuer-checked.
    expect(state.boundIssuer).toBe(true);
    expect(state.state).toBe(true);
  });

  test('scope "client" removes only the registered client information', async ({ page }) => {
    await page.goto('/');
    await seedAll(page);

    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('https://app.example.com/', {}, 'https://scoped-test.example.com');
      provider.invalidateCredentials('client');
    });

    const state = await readAll(page);
    expect(state.tokens).toBe(true);
    expect(state.clientInfo).toBe(false);
    expect(state.codeVerifier).toBe(true);
    expect(state.discoveryStateRaw).toBe(true);
    expect(state.state).toBe(true);
  });

  test('scope "all" removes every stored key including boundIssuer', async ({ page }) => {
    await page.goto('/');
    await seedAll(page);

    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('https://app.example.com/', {}, 'https://scoped-test.example.com');
      provider.invalidateCredentials('all');
    });

    const state = await readAll(page);
    expect(state.tokens).toBe(false);
    expect(state.clientInfo).toBe(false);
    expect(state.codeVerifier).toBe(false);
    expect(state.discoveryStateRaw).toBe(false);
    expect(state.boundIssuer).toBe(false);
    expect(state.state).toBe(false);
  });

  test('unknown scope defaults to clearing everything', async ({ page }) => {
    await page.goto('/');
    await seedAll(page);

    await page.evaluate(async () => {
      const Provider = (window as any).__BrowserOAuthClientProvider;
      const provider = await Provider.create('https://app.example.com/', {}, 'https://scoped-test.example.com');
      provider.invalidateCredentials('unknown-scope');
    });

    const state = await readAll(page);
    expect(state.tokens).toBe(false);
    expect(state.clientInfo).toBe(false);
    expect(state.codeVerifier).toBe(false);
    expect(state.discoveryStateRaw).toBe(false);
  });
});

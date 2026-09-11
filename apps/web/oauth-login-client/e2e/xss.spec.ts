/**
 * XSS regression tests — server-controlled MCP metadata must not execute as HTML.
 *
 * The MCP server can return arbitrary strings for tool names, descriptions,
 * resource URIs, and MIME types.  These tests inject classic XSS payloads into
 * those fields via a Playwright route interceptor and assert that:
 *   1. No injected script ever executes (sentinel window.__xss remains 0).
 *   2. The payload text is rendered literally in the correct DOM container,
 *      not parsed as markup.
 *
 * This protects against DOM XSS that could steal OAuth tokens stored in
 * sessionStorage.
 */
import { test, expect } from '@playwright/test';

const XSS_TOOL_NAME = '<img src=x onerror="window.__xss=1">';
const XSS_TOOL_DESC = '<svg onload="window.__xss=1"></svg><script>window.__xss=1</script>';
const XSS_MIME_TYPE = '"><script>window.__xss=1</script>';
const XSS_URI = 'javascript:window.__xss=1';

/** Build a minimal JSON-RPC MCP response for the given method. */
function buildMcpResponse(method: string, id: unknown): unknown {
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'xss-test-server', version: '0.0.0' },
      },
    };
  }
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: XSS_TOOL_NAME,
            description: XSS_TOOL_DESC,
            inputSchema: { type: 'object', properties: {} }
          },
        ],
      },
    };
  }
  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        resources: [{ uri: XSS_URI, name: 'xss-resource', mimeType: XSS_MIME_TYPE }],
      },
    };
  }
  if (method === 'resources/read') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{ uri: XSS_URI, mimeType: XSS_MIME_TYPE, text: 'safe content' }],
      },
    };
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  };
}

test.describe('XSS regression — server-controlled MCP metadata', () => {
  test.beforeEach(async ({ page }) => {
    // Place a sentinel that XSS payloads would set if they execute
    await page.addInitScript(() => {
      (window as any).__xss = 0;
    });

    // Intercept every MCP POST request (any URL that is not the Vite dev server)
    // and return a crafted response with XSS payloads.
    await page.route('**', async (route) => {
      const req = route.request();
      const url = req.url();
      const isLocal =
        url.startsWith('http://localhost:5173') ||
        url.startsWith('http://localhost:4173') ||
        url.startsWith('http://127.0.0.1:5173') ||
        url.startsWith('http://127.0.0.1:4173') ||
        url.startsWith('data:');

      // Only intercept external POST fetches (the MCP transport calls)
      if (req.method() !== 'POST' || isLocal) {
        return route.continue();
      }

      let body: any = {};
      try {
        body = JSON.parse(req.postData() ?? '{}');
      } catch {
        // non-JSON body — pass through
        return route.continue();
      }

      // Notifications have no id; acknowledge silently
      if (body.method && body.id === undefined) {
        await route.fulfill({ status: 202, body: '' });
        return;
      }

      const response = buildMcpResponse(body.method, body.id);
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Mcp-Session-Id': 'xss-test-session',
        },
        body: JSON.stringify(response),
      });
    });

    await page.goto('/');
  });

  test('no injected script executes via tool name or description', async ({ page }) => {
    await page.click('#login-btn');

    // Wait for the MCP round-trip to complete — fail loudly on timeout so a
    // rendering regression does not produce a false-passing test.
    await page.waitForSelector('#content:not(.hidden)', { timeout: 8000 });

    // Confirm the tools container has rendered at least one card
    await page.waitForSelector('[data-testid="tools-container"] .card-title', { timeout: 5000 });

    const xssFired = await page.evaluate(() => (window as any).__xss);
    expect(xssFired).toBe(0);
  });

  test('no injected script executes via resource URI or MIME type', async ({ page }) => {
    await page.click('#login-btn');

    // Wait for content section AND at least one resource card
    await page.waitForSelector('#content:not(.hidden)', { timeout: 8000 });
    await page.waitForSelector('[data-testid="resources-container"] .card-title', { timeout: 5000 });

    const xssFired = await page.evaluate(() => (window as any).__xss);
    expect(xssFired).toBe(0);
  });

  test('malicious tool name is rendered as literal text in tools container', async ({ page }) => {
    await page.click('#login-btn');
    await page.waitForSelector('#content:not(.hidden)', { timeout: 8000 });
    await page.waitForSelector('[data-testid="tools-container"] .card-title', { timeout: 5000 });

    // 1. The injected <img> must NOT appear as a real DOM element
    await expect(page.locator('img[src="x"]')).toHaveCount(0);

    // 2. The tool name card-title must contain the XSS_TOOL_NAME payload as
    //    literal text — NOT the resource URI (which is the separate XSS_URI value).
    const toolTitle = page.locator('[data-testid="tools-container"] .card-title').first();
    await expect(toolTitle).toContainText(XSS_TOOL_NAME);
  });

  test('malicious resource URI is rendered as literal text in resources container', async ({ page }) => {
    await page.click('#login-btn');
    await page.waitForSelector('#content:not(.hidden)', { timeout: 8000 });
    await page.waitForSelector('[data-testid="resources-container"] .card-title', { timeout: 5000 });

    // The resource card-title must contain the XSS_URI payload as literal text.
    const resourceTitle = page.locator('[data-testid="resources-container"] .card-title').first();
    await expect(resourceTitle).toContainText(XSS_URI);
  });

  test('error container does not expose unescaped server strings', async ({ page }) => {
    // Override to return an error response for all tool/resource calls
    await page.route('**', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.continue();

      let body: any = {};
      try { body = JSON.parse(req.postData() ?? '{}'); } catch { return route.continue(); }

      if (body.method === 'initialize') {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'err-session' },
          body: JSON.stringify(buildMcpResponse('initialize', body.id)),
        });
        return;
      }
      // Return an error with XSS payload in the message
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'err-session' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: -32000,
            message: '<img src=x onerror="window.__xss=1"> server error',
          },
        }),
      });
    });

    await page.click('#login-btn');
    await page.waitForTimeout(3000);

    const xssFired = await page.evaluate(() => (window as any).__xss);
    expect(xssFired).toBe(0);
    // The injected <img> must not be in the DOM
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});

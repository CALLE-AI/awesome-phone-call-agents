import './style.css';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { BrowserOAuthClientProvider } from './oauth-provider.js';

/**
 * MCP server endpoint.
 *
 * Override at build time via the VITE_MCP_SERVER_URL environment variable
 * (e.g. set it in .env.mock to point at the local offline server).
 * Falls back to the default remote endpoint when the variable is unset.
 */
const SERVER_URL =
  (import.meta.env.VITE_MCP_SERVER_URL as string | undefined) ||
  'https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth';
const SCOPE = 'openid email profile';

let transport: StreamableHTTPClientTransport | null = null;
let client: Client | null = null;

// Keep a reference to the active provider so the logout button can call it.
let activeProvider: BrowserOAuthClientProvider | null = null;

const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const contentSection = document.getElementById('content') as HTMLDivElement;
const toolsContainer = document.getElementById('tools-container') as HTMLDivElement;
const resourcesContainer = document.getElementById('resources-container') as HTMLDivElement;
const errorContainer = document.getElementById('error-container') as HTMLDivElement;
const errorText = document.getElementById('error-text') as HTMLParagraphElement;
const btnText = document.getElementById('btn-text') as HTMLSpanElement;
const btnLoader = document.getElementById('btn-loader') as HTMLDivElement;

const toolModal = document.getElementById('tool-modal') as HTMLDivElement;
const modalTitle = document.getElementById('modal-title') as HTMLHeadingElement;
const modalDetails = document.getElementById('modal-details') as HTMLPreElement;
const modalClose = document.getElementById('modal-close') as HTMLButtonElement;

modalClose.addEventListener('click', () => {
  toolModal.classList.add('hidden');
});
toolModal.addEventListener('click', (e) => {
  if (e.target === toolModal) toolModal.classList.add('hidden');
});

function showError(msg: string) {
  errorContainer.classList.remove('hidden');
  errorText.textContent = msg;
  console.error(msg);
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

/**
 * Connection state machine:
 *
 *   'disconnected' — initial / after logout
 *   'authenticating' — transport connected, OAuth token valid; capabilities in-flight
 *   'connected'      — BOTH listTools AND listResources succeeded
 *   'degraded'       — transport connected but only ONE capability returned data
 *   'error'          — transport-level failure or both capabilities failed
 */
type ConnectionStatus = 'disconnected' | 'authenticating' | 'connected' | 'degraded' | 'error';

function updateStatus(status: ConnectionStatus) {
  statusDot.classList.remove('connected', 'authenticating', 'degraded', 'error');
  logoutBtn.classList.add('hidden');

  switch (status) {
    case 'connected':
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      loginBtn.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      contentSection.classList.remove('hidden');
      break;
    case 'degraded':
      statusDot.classList.add('degraded');
      statusText.textContent = 'Partial — one capability unavailable';
      loginBtn.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      contentSection.classList.remove('hidden');
      break;
    case 'authenticating':
      statusDot.classList.add('authenticating');
      statusText.textContent = 'Authenticating\u2026';
      loginBtn.classList.add('hidden');
      break;
    case 'error':
      statusDot.classList.add('error');
      statusText.textContent = 'Error';
      loginBtn.classList.remove('hidden');
      loginBtn.disabled = false;
      btnText.textContent = 'Connect \u0026 Login';
      btnLoader.classList.add('hidden');
      break;
    default:
      statusText.textContent = 'Disconnected';
      loginBtn.classList.remove('hidden');
      loginBtn.disabled = false;
      btnText.textContent = 'Connect \u0026 Login';
      btnLoader.classList.add('hidden');
      break;
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

function handleLogout() {
  if (activeProvider) {
    activeProvider.clearCredentials();
    activeProvider = null;
  }
  if (transport) {
    try { transport.close(); } catch { /* ignore */ }
    transport = null;
  }
  client = null;
  toolsContainer.innerHTML = '';
  resourcesContainer.innerHTML = '';
  errorContainer.classList.add('hidden');
  contentSection.classList.add('hidden');
  updateStatus('disconnected');
}

logoutBtn.addEventListener('click', handleLogout);

// ---------------------------------------------------------------------------
// Safe static SVG markup (no user-supplied data interpolated here)
// ---------------------------------------------------------------------------

const TOOL_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"' +
  ' stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
  ' stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6' +
  ' 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91' +
  ' 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76' +
  ' 3.76z"></path></svg>';

const RESOURCE_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"' +
  ' stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
  ' stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0' +
  ' 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8' +
  ' 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line>' +
  '<line x1="16" y1="17" x2="8" y2="17"></line>' +
  '<polyline points="10 9 9 9 8 9"></polyline></svg>';

// ---------------------------------------------------------------------------
// Rendering — all server-controlled values written via textContent / DOM
// properties, never via innerHTML template literals, to prevent DOM XSS.
// ---------------------------------------------------------------------------

function renderTools(tools: any[]) {
  toolsContainer.innerHTML = '';
  if (tools.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'data-card empty-card';
    const p = document.createElement('p');
    p.textContent = 'No tools available';
    empty.appendChild(p);
    toolsContainer.appendChild(empty);
    return;
  }
  for (const tool of tools) {
    const card = document.createElement('div');
    card.className = 'data-card tool-card clickable';

    const header = document.createElement('div');
    header.className = 'card-header';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'icon-wrapper tool-icon';
    iconWrapper.innerHTML = TOOL_SVG; // static — no user data

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-title';
    titleEl.textContent = tool.name; // safe: textContent

    header.appendChild(iconWrapper);
    header.appendChild(titleEl);

    const descEl = document.createElement('p');
    descEl.className = 'card-desc';
    descEl.textContent = tool.description || 'No description available for this tool.';

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Click for Details';
    footer.appendChild(badge);

    card.appendChild(header);
    card.appendChild(descEl);
    card.appendChild(footer);

    card.addEventListener('click', () => {
      modalTitle.textContent = tool.name;
      modalDetails.textContent =
        tool.description || 'No description available for this tool.';
      toolModal.classList.remove('hidden');
    });
    toolsContainer.appendChild(card);
  }
}

function renderResources(resourcesResult: any) {
  resourcesContainer.innerHTML = '';
  if (
    !resourcesResult ||
    resourcesResult.content_count === 0 ||
    resourcesResult.contents.length === 0
  ) {
    const empty = document.createElement('div');
    empty.className = 'data-card empty-card';
    const p = document.createElement('p');
    p.textContent = 'No resources available';
    empty.appendChild(p);
    resourcesContainer.appendChild(empty);
    return;
  }
  for (const content of resourcesResult.contents) {
    const card = document.createElement('div');
    card.className = 'data-card resource-card clickable';
    const isError = content.type; // present only for non-dict summarize sentinel
    const rawUri: string = typeof content.uri === 'string' ? content.uri : '';
    const uriName = isError
      ? 'Unknown Resource'
      : rawUri
      ? rawUri.split('/').pop() || rawUri
      : 'Resource';

    const header = document.createElement('div');
    header.className = 'card-header';

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'icon-wrapper resource-icon';
    iconWrapper.innerHTML = RESOURCE_SVG; // static — no user data

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-title';
    if (!isError && rawUri) {
      titleEl.title = rawUri; // safe: DOM property, not attribute string injection
    }
    titleEl.textContent = uriName; // safe: textContent

    header.appendChild(iconWrapper);
    header.appendChild(titleEl);

    const descEl = document.createElement('p');
    descEl.className = 'card-desc';
    descEl.textContent = isError
      ? 'Error reading resource.'
      : content.mime_type || 'Unknown MIME type'; // safe: textContent

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    footer.style.cssText = 'display:flex;gap:0.5rem;';

    const sizeBadge = document.createElement('span');
    sizeBadge.className = 'badge badge-secondary';
    sizeBadge.textContent =
      content.text_bytes !== undefined ? `${content.text_bytes} bytes` : '';

    const dlBadge = document.createElement('span');
    dlBadge.className = 'badge';
    dlBadge.style.cssText =
      'background:rgba(59,130,246,0.15);color:#60a5fa;' +
      'border:1px solid rgba(59,130,246,0.2);';
    dlBadge.textContent = 'Download JSON';

    footer.appendChild(sizeBadge);
    footer.appendChild(dlBadge);

    card.appendChild(header);
    card.appendChild(descEl);
    card.appendChild(footer);

    if (!isError && rawUri) {
      card.addEventListener('click', async () => {
        if (!client) return;
        try {
          const origText = dlBadge.textContent;
          dlBadge.textContent = 'Downloading...';
          const result = await client.readResource({ uri: rawUri });
          const blob = new Blob([JSON.stringify(result, null, 2)], {
            type: 'application/json',
          });
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = `${uriName}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(objectUrl);
          dlBadge.textContent = origText;
        } catch (err: any) {
          console.error('Error downloading resource', err);
          showError(`Failed to download resource: ${err.message}`);
        }
      });
    }
    resourcesContainer.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Connection flow
// ---------------------------------------------------------------------------

function makeClientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: 'CALL-E OAuth Login Web App',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPE,
  };
}

async function connect() {
  try {
    loginBtn.disabled = true;
    btnText.textContent = 'Connecting...';
    btnLoader.classList.remove('hidden');
    errorContainer.classList.add('hidden');

    const redirectUri = window.location.origin + window.location.pathname;
    const provider = new BrowserOAuthClientProvider(
      redirectUri,
      makeClientMetadata(redirectUri),
      SERVER_URL
    );
    activeProvider = provider;

    client = new Client(
      { name: 'calle-oauth-web-client', version: '1.0.0' },
      { capabilities: {} }
    );
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
      authProvider: provider,
    });

    try {
      await client.connect(transport);
      await onConnected();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log('Redirecting for authorization...');
        return; // The provider already handled the redirect.
      }
      throw error;
    }
  } catch (error: any) {
    loginBtn.disabled = false;
    btnText.textContent = 'Connect \u0026 Login';
    btnLoader.classList.add('hidden');
    showError(error.message || String(error));
  }
}

/**
 * Called once the transport layer is authenticated.
 *
 * Phase 1: Mark as "Authenticating" immediately — the transport OAuth token
 *   is valid but we have not yet confirmed the integration is usable.
 * Phase 2: Fetch capabilities:
 *   - BOTH succeed  → 'connected'   (fully healthy)
 *   - ONE succeeds  → 'degraded'    (partial — one capability unavailable)
 *   - NEITHER       → 'error'       (connection is not usable)
 */
async function onConnected() {
  if (!client) return;
  updateStatus('authenticating'); // Phase 1

  let toolsOk = false;
  let resourcesOk = false;

  try {
    const toolsResult = await client.listTools();
    renderTools(toolsResult.tools);
    toolsOk = true;
  } catch (err: any) {
    console.error('Error listing tools', err);
    renderTools([]);
  }

  try {
    const resources = await client.listResources();
    if (resources.resources.length > 0) {
      const firstResource = resources.resources[0];
      const result = await client.readResource({ uri: firstResource.uri });
      const summarized = summarizeResourceResult(result as any);
      renderResources(summarized);
    } else {
      renderResources({ content_count: 0, contents: [] });
    }
    resourcesOk = true;
  } catch (err: any) {
    console.error('Error listing/reading resources', err);
    // Build error card via DOM — err.message is untrusted text
    const errCard = document.createElement('div');
    errCard.className = 'data-card error-card';
    const errP = document.createElement('p');
    errP.textContent = `Error: ${err.message}`;
    errCard.appendChild(errP);
    resourcesContainer.appendChild(errCard);
  }

  // Phase 2: promote to the most accurate readiness level
  if (toolsOk && resourcesOk) {
    updateStatus('connected');
    contentSection.classList.remove('hidden');
  } else if (toolsOk || resourcesOk) {
    updateStatus('degraded');
    contentSection.classList.remove('hidden');
  } else {
    updateStatus('error');
    showError('Connected to server but could not load tools or resources.');
  }
}

function summarizeResourceResult(result: Record<string, unknown>) {
  const contents = Array.isArray(result.contents) ? result.contents : [];
  return {
    content_count: contents.length,
    contents: contents.map((content) => {
      if (!content || typeof content !== 'object') {
        return { type: typeof content };
      }
      const item = content as Record<string, unknown>;
      const text = typeof item.text === 'string' ? item.text : '';
      return {
        uri: typeof item.uri === 'string' ? item.uri : undefined,
        mime_type: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        text_bytes: new TextEncoder().encode(text).length,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// OAuth callback handling
// ---------------------------------------------------------------------------

async function checkOAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');
  const returnedState = url.searchParams.get('state');

  if (errorParam) {
    showError(`OAuth Error: ${errorParam}`);
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (code) {
    loginBtn.disabled = true;
    btnText.textContent = 'Completing Login...';
    btnLoader.classList.remove('hidden');

    const redirectUri = window.location.origin + window.location.pathname;
    const provider = new BrowserOAuthClientProvider(
      redirectUri,
      makeClientMetadata(redirectUri),
      SERVER_URL
    );
    activeProvider = provider;

    client = new Client(
      { name: 'calle-oauth-web-client', version: '1.0.0' },
      { capabilities: {} }
    );
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
      authProvider: provider,
    });

    // Always clean the callback params from the address bar first, regardless
    // of whether auth succeeds or fails — the authorization code must not
    // remain visible or be replayable from the browser history.
    window.history.replaceState({}, document.title, window.location.pathname);

    try {
      // Validate CSRF state before exchanging the code.
      if (!returnedState) {
        throw new Error(
          'OAuth callback is missing the required state parameter. ' +
          'Login aborted to prevent CSRF.'
        );
      }
      provider.validateState(returnedState);

      await transport.finishAuth(code);
      await client.connect(transport);
      await onConnected();
    } catch (error: any) {
      loginBtn.disabled = false;
      btnText.textContent = 'Connect \u0026 Login';
      btnLoader.classList.add('hidden');
      showError(`Failed to finish auth: ${error.message || String(error)}`);
    }
  }
}

loginBtn.addEventListener('click', connect);

window.addEventListener('DOMContentLoaded', () => {
  checkOAuthCallback();
});

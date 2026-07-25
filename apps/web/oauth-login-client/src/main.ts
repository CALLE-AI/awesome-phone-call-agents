import './style.css';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { BrowserOAuthClientProvider } from './oauth-provider.js';

const SERVER_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const SCOPE = "openid email profile";

let transport: StreamableHTTPClientTransport | null = null;
let client: Client | null = null;

const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
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

function updateStatus(connected: boolean) {
  if (connected) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('error');
    statusText.textContent = 'Connected';
    loginBtn.classList.add('hidden');
    contentSection.classList.remove('hidden');
  } else {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Disconnected';
  }
}

function renderTools(tools: any[]) {
  toolsContainer.innerHTML = '';
  if (tools.length === 0) {
    toolsContainer.innerHTML = '<div class="data-card empty-card"><p>No tools available</p></div>';
    return;
  }
  for (const tool of tools) {
    const card = document.createElement('div');
    card.className = 'data-card tool-card clickable';
    card.innerHTML = `
      <div class="card-header">
        <div class="icon-wrapper tool-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
        </div>
        <h3 class="card-title">${tool.name}</h3>
      </div>
      <p class="card-desc">${tool.description || 'No description available for this tool.'}</p>
      <div class="card-footer">
        <span class="badge">Click for Details</span>
      </div>
    `;
    card.addEventListener('click', () => {
      modalTitle.textContent = tool.name;
      modalDetails.textContent = tool.description || 'No description available for this tool.';
      toolModal.classList.remove('hidden');
    });
    toolsContainer.appendChild(card);
  }
}

function renderResources(resourcesResult: any) {
  resourcesContainer.innerHTML = '';
  if (!resourcesResult || resourcesResult.content_count === 0 || resourcesResult.contents.length === 0) {
    resourcesContainer.innerHTML = '<div class="data-card empty-card"><p>No resources available</p></div>';
    return;
  }
  for (const content of resourcesResult.contents) {
    const card = document.createElement('div');
    card.className = 'data-card resource-card clickable';
    const isError = content.type; // type is set when content isn't a dict in summarizeResourceResult
    const uriName = isError ? 'Unknown Resource' : (content.uri ? content.uri.split('/').pop() : 'Resource');
    
    card.innerHTML = `
      <div class="card-header">
        <div class="icon-wrapper resource-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </div>
        <h3 class="card-title" title="${content.uri || ''}">${uriName}</h3>
      </div>
      <p class="card-desc">${isError ? 'Error reading resource.' : (content.mime_type || 'Unknown MIME type')}</p>
      <div class="card-footer" style="display: flex; gap: 0.5rem;">
        <span class="badge badge-secondary">${content.text_bytes !== undefined ? content.text_bytes + ' bytes' : ''}</span>
        <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2);">Download JSON</span>
      </div>
    `;
    
    if (!isError && content.uri) {
      card.addEventListener('click', async () => {
        if (!client) return;
        try {
          // Temporarily show loading state
          const badge = card.querySelector('.badge:last-child') as HTMLSpanElement;
          const origText = badge.textContent;
          badge.textContent = 'Downloading...';
          
          const result = await client.readResource({ uri: content.uri });
          const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${uriName}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          badge.textContent = origText;
        } catch (err: any) {
          console.error("Error downloading resource", err);
          showError(`Failed to download resource: ${err.message}`);
        }
      });
    }
    resourcesContainer.appendChild(card);
  }
}

async function connect() {
  try {
    loginBtn.disabled = true;
    btnText.textContent = 'Connecting...';
    btnLoader.classList.remove('hidden');
    errorContainer.classList.add('hidden');

    const redirectUri = window.location.origin + window.location.pathname;
    
    const clientMetadata: OAuthClientMetadata = {
      client_name: "CALL-E OAuth Login Web App",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    };

    const provider = new BrowserOAuthClientProvider(redirectUri, clientMetadata);
    
    client = new Client({ name: "calle-oauth-web-client", version: "1.0.0" }, { capabilities: {} });
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), { authProvider: provider });

    try {
      await client.connect(transport);
      await onConnected();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log("Redirecting for authorization...");
        return; // The provider already handled the redirect.
      }
      throw error;
    }

  } catch (error: any) {
    loginBtn.disabled = false;
    btnText.textContent = 'Connect & Login';
    btnLoader.classList.add('hidden');
    showError(error.message || String(error));
  }
}

async function onConnected() {
  if (!client) return;
  updateStatus(true);
  
  try {
    const toolsResult = await client.listTools();
    renderTools(toolsResult.tools);
  } catch (err: any) {
    console.error("Error listing tools", err);
    renderTools([]);
  }

  try {
    const resources = await client.listResources();
    if (resources.resources.length > 0) {
      const firstResource = resources.resources[0];
      const result = await client.readResource({ uri: firstResource.uri });
      // Use the summarize function to match TS implementation
      const summarized = summarizeResourceResult(result as any);
      renderResources(summarized);
    } else {
      renderResources({ content_count: 0, contents: [] });
    }
  } catch (err: any) {
    console.error("Error listing/reading resources", err);
    resourcesContainer.innerHTML = `<div class="data-card error-card"><p>Error: ${err.message}</p></div>`;
  }
}

function summarizeResourceResult(result: Record<string, unknown>) {
  const contents = Array.isArray(result.contents) ? result.contents : [];
  return {
    content_count: contents.length,
    contents: contents.map((content) => {
      if (!content || typeof content !== "object") {
        return { type: typeof content };
      }
      const item = content as Record<string, unknown>;
      const text = typeof item.text === "string" ? item.text : "";
      return {
        uri: typeof item.uri === "string" ? item.uri : undefined,
        mime_type: typeof item.mimeType === "string" ? item.mimeType : undefined,
        text_bytes: new TextEncoder().encode(text).length,
      };
    }),
  };
}

async function checkOAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    showError(`OAuth Error: ${errorParam}`);
    // Clear URL
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (code) {
    // We have a code, let's finish auth
    loginBtn.disabled = true;
    btnText.textContent = 'Completing Login...';
    btnLoader.classList.remove('hidden');

    const redirectUri = window.location.origin + window.location.pathname;
    const clientMetadata: OAuthClientMetadata = {
      client_name: "CALL-E OAuth Login Web App",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    };
    const provider = new BrowserOAuthClientProvider(redirectUri, clientMetadata);
    
    client = new Client({ name: "calle-oauth-web-client", version: "1.0.0" }, { capabilities: {} });
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), { authProvider: provider });

    try {
      await transport.finishAuth(code);
      // clear the URL
      window.history.replaceState({}, document.title, window.location.pathname);
      await client.connect(transport);
      await onConnected();
    } catch (error: any) {
      loginBtn.disabled = false;
      btnText.textContent = 'Connect & Login';
      btnLoader.classList.add('hidden');
      showError(`Failed to finish auth: ${error.message || String(error)}`);
    }
  }
}

loginBtn.addEventListener('click', connect);

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  checkOAuthCallback();
});

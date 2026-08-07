# Web CALL-E OAuth Login App

A web-based OAuth client for the Model Context Protocol (MCP) using Vite and
Vanilla TypeScript.  This application demonstrates how to authenticate a web
client using OAuth and connect to a streamable HTTP MCP server, list available
tools, and read resources.

## Features

- **Rich UI**: Modern dark-mode, glassmorphism, and micro-animations.
- **Browser-native OAuth**: Uses `sessionStorage` to persist OAuth state across
  the redirect flow, unlike Node.js apps which need a local HTTP callback server.
- **Configurable endpoint**: Override the MCP server URL via environment variable
  for offline testing or alternative deployments.
- **Offline demo mode**: A local mock server lets you explore the full UI flow
  without live credentials.
- **XSS-safe rendering**: All server-controlled strings (tool names, descriptions,
  resource URIs, MIME types, error messages) are rendered via `textContent` and
  DOM properties — never via `innerHTML` template literals — to prevent DOM XSS
  from a malicious MCP server.

## Setup

```bash
npm install
```

## Running

### Live mode (OAuth required)

Connects to the remote MCP server. OAuth credentials and a provider-registered
client are required.

```bash
npm run dev
```

Open `http://localhost:5173/` and click **Connect & Login** to begin the OAuth flow.

### Offline / mock mode (no credentials required)

Starts a local mock MCP server on port 3001 and configures Vite to point at it.
No OAuth provider, no outbound network calls, no credentials needed.

```bash
npm run dev:mock
```

Open `http://localhost:5173/` and click **Connect & Login**.  The app connects
to the local mock server and displays a set of demo tools.

### Configuring a custom endpoint

Set `VITE_MCP_SERVER_URL` in a `.env` file (or any Vite-compatible env file) to
point the app at a different MCP server:

```env
VITE_MCP_SERVER_URL=https://your-mcp-server.example.com/mcp
```

## Usage (live mode)

1. Click **Connect & Login**.
2. You will be redirected to the CALL-E OAuth provider.
3. Authenticate to grant permissions.
4. You will be redirected back with `?code=…`.
5. The app completes the authorization flow.
6. Status shows **Authenticating…** while tools and resources are fetched.
7. Status promotes to **Connected** once capabilities load successfully.

## Running E2E Tests

```bash
npm run test:e2e
```

Tests include:

- **UI state tests** (`example.spec.ts`): verifies title, login button, status
  text, and hidden sections on initial load.
- **XSS regression tests** (`xss.spec.ts`): injects HTML/script payloads into
  every MCP metadata field via Playwright route interception and asserts nothing
  executes.

## Architecture & Safety Notes

- **Redirect handling**: The `?code=…` parameter is removed from the URL after
  successful authorization to avoid token leakage on refresh.
- **Credentials**: No long-term secrets are required.  Authentication is deferred
  to the CALL-E OAuth provider.
- **No side effects**: Tool and resource listings are read-only operations.
  No phone calls are placed automatically.
- **Mock server safety**: The offline mock server binds to `127.0.0.1` only
  (loopback), returns no real data, and places no calls.

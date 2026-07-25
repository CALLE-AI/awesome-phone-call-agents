# Web CALL-E OAuth Login App

A web-based OAuth client for the Model Context Protocol (MCP) using Vite and Vanilla TypeScript.
This application demonstrates how to authenticate a web client using OAuth and connect to a streamable HTTP MCP server, list available tools, and read resources.

## Features

- **Rich UI**: Uses modern web aesthetics with dark mode, glassmorphism, and animations.
- **Browser-native OAuth**: Uses `sessionStorage` to persist the OAuth state across the redirect flow, unlike Node.js apps which might run a local HTTP server callback.
- **Vite & Vanilla TS**: Lightweight and easily extensible.

## Setup & Run

Make sure you have Node.js installed, then install dependencies:

```bash
npm install
```

Start the Vite development server:

```bash
npm run dev
```

Open the local URL provided by Vite (e.g., `http://localhost:5173/`) in your browser.

## Usage

1. Click **Connect & Login**.
2. You will be redirected to the CALL-E OAuth provider.
3. Authenticate to grant permissions.
4. You will be redirected back to the app (`?code=...`).
5. The application will complete the authorization, connect to the MCP server, and display the available tools and resources.

## Architecture & Safety Notes

- **Redirect Handling**: The application handles the OAuth `code` parameter gracefully and removes it from the URL after successful authorization to avoid token leakage upon refresh.
- **Credentials**: No long-term secrets or explicit credentials are required to run this app. The authentication is fully deferred to the CALL-E OAuth provider.
- **No Side Effects**: The default tools and resource listings are safe operations and do not trigger outbound phone calls or jobs automatically.

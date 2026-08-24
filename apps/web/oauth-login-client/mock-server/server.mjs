/**
 * Minimal offline MCP server for local development and E2E infrastructure.
 *
 * Start with:  node mock-server/server.mjs
 * Or via npm:  npm run dev:mock
 *
 * No OAuth is required.  The server returns a fixed set of demo tools and an
 * empty resource list so the app can be exercised without live credentials or
 * outbound network access.
 *
 * Safety notes:
 *   - Binds to 127.0.0.1 only (loopback). Not exposed to the network.
 *   - Does not place real calls or create any side-effects.
 *   - No credentials are stored or transmitted.
 */

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3001);

/** Demo tools that represent typical AI-agent phone-call capabilities. */
const DEMO_TOOLS = [
  {
    name: 'make-call',
    description: 'Place an outbound AI-agent phone call to an E.164 number.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'E.164 number (e.g. +12125551234)' },
        message: { type: 'string', description: 'Message the agent will deliver.' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'get-call-status',
    description: 'Retrieve the status of a scheduled or in-progress call.',
    inputSchema: {
      type: 'object',
      properties: {
        callId: { type: 'string', description: 'Identifier returned by make-call.' },
      },
      required: ['callId'],
    },
  },
  {
    name: 'cancel-call',
    description: 'Cancel a scheduled call before it is placed.',
    inputSchema: {
      type: 'object',
      properties: {
        callId: { type: 'string' },
      },
      required: ['callId'],
    },
  },
  {
    name: 'list-calls',
    description: 'List recent calls and their statuses.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20).' },
      },
    },
  },
];

// Headers sent with every real response
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

// Preflight responses use wildcard allow-headers so any header the MCP SDK
// adds (e.g. mcp-protocol-version, mcp-session-id, authorization) is
// automatically permitted without maintaining an explicit allowlist.
const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

let sessionCounter = 0;

/** Dispatch a JSON-RPC method to a mock result. */
function dispatch(method, id, _params) {
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'calle-mock-mcp', version: '0.0.0' },
      },
    };
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: DEMO_TOOLS } };
  }
  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: [] } };
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const server = http.createServer((req, res) => {
  // CORS preflight — wildcard headers so any MCP SDK header is accepted
  if (req.method === 'OPTIONS') {
    res.writeHead(204, PREFLIGHT_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const sessionId =
      String(req.headers['mcp-session-id'] ?? `mock-session-${++sessionCounter}`);

    // Notifications (no id field) — acknowledge without a body
    if (msg.method && msg.id === undefined) {
      res.writeHead(202, { ...CORS_HEADERS, 'Mcp-Session-Id': sessionId });
      res.end();
      return;
    }

    const response = dispatch(msg.method, msg.id, msg.params);
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Mcp-Session-Id': sessionId,
    });
    res.end(JSON.stringify(response));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-mcp] Listening on http://localhost:${PORT}/mcp`);
  console.log('[mock-mcp] No OAuth required — offline demo mode.');
  console.log('[mock-mcp] Configured via: VITE_MCP_SERVER_URL=http://localhost:3001/mcp');
});

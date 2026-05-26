# TypeScript CALL-E OAuth Login App

This app demonstrates the standard MCP OAuth flow over Streamable HTTP.

Run:

```bash
pnpm install --ignore-workspace --lockfile=false
pnpm start
pnpm check
pnpm test:e2e
```

The default e2e tests use the local fake broker/OAuth/MCP server from `apps/shared/`, so they do not require live OAuth or CALL-E credentials.

Live checks are opt-in. Configure `MCP_SERVER_URL`, `MCP_REDIRECT_URI`, and `MCP_SCOPE` before running against a real server.

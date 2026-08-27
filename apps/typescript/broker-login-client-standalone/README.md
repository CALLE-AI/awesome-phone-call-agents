# Standalone TypeScript CALL-E Broker Login App

This app demonstrates CALL-E brokered login with MCP HTTP calls without a shared package dependency.

Run:

```bash
pnpm install --ignore-workspace --lockfile=false
pnpm start
pnpm check
pnpm test:e2e
```

The default e2e tests use the local fake broker/OAuth/MCP server from `apps/shared/`, so they do not require live CALL-E credentials or browser login.

Live checks are opt-in. Configure `MCP_BASE_URL`, `MCP_SERVER_URL`, `MCP_BROKER_BASE_URL`, and `MCP_AUTH_BASE_URL` before running against a real server.

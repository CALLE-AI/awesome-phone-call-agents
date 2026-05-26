# Apps

Use this directory for runnable phone-call workflow apps, including focused demo apps for MCP, CLI, plugin, scheduler, or host integration patterns.

Apps should directly help AI agents schedule, monitor, administer, or safely operate phone-call workflows. This includes focused integration apps for MCP, CLI, plugin, scheduler, and host patterns. They are not CALL-E SDKs or supported product APIs.

Current apps:

| App | Language | Purpose |
| --- | --- | --- |
| [`python/batch-runner`](python/batch-runner/) | Python | JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |
| [`python/broker-login-client`](python/broker-login-client/) | Python | CALL-E brokered login client with local token cache and MCP HTTP calls. |
| [`typescript/broker-login-client`](typescript/broker-login-client/) | TypeScript | CALL-E brokered login client using `@call-e/core`. |
| [`typescript/broker-login-client-standalone`](typescript/broker-login-client-standalone/) | TypeScript | CALL-E brokered login client without a shared package dependency. |
| [`python/oauth-login-client`](python/oauth-login-client/) | Python | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`typescript/oauth-login-client`](typescript/oauth-login-client/) | TypeScript | CALL-E OAuth login client for MCP Streamable HTTP. |

Suggested grouping:

```text
apps/
├── python/
│   └── app-name/
├── typescript/
│   └── app-name/
├── web/
│   └── app-name/
└── shared/
```

Every app should include its own README with setup, usage, side effects, credential handling, dry-run or preview behavior, and cancellation or rollback instructions when it can create calls or recurring jobs.

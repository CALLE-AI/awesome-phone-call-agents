# CALL-E mapping for capacity-backfill-cascade

## Auth (calle CLI, npm package @call-e/cli)

```bash
calle auth login --base-url https://seleven-mcp-sg.airudder.com --channel openagent_oauth
calle auth status --json
```

`auth status` reports `usable` and the token cache path. The reference app reads the
access token from that cache (default root `~/.calle-mcp/cli`) and never stores it.

## Calls (MCP Streamable HTTP)

Server URL: `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`
Auth: `Authorization: Bearer <access token from the CLI cache>`

| Step | MCP tool | Arguments | Returns |
| --- | --- | --- | --- |
| 1 | plan_call | to_phones, goal, optional region/language | plan_id, confirm_token, ready_to_run |
| 2 | run_call | plan_id, confirm_token | run_id |
| 3 | get_call_run | run_id | status, post_summary (poll until terminal) |

Terminal statuses: BUSY, CANCELED, CANCELLED, COMPLETED, DECLINED, EXPIRED, FAILED,
NO_ANSWER, VOICEMAIL.

The same integration pattern is implemented upstream in
`apps/python/batch-runner`; this skill uses `apps/python/table-rescue` as its
reference engine.

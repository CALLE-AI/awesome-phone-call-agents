# CALL-E host integration

Source: [official MCP contract](https://github.com/CALLE-AI/call-e-integrations/blob/main/docs/mcp/openagent-oauth.md),
reviewed 2026-09-13. Discover current schemas using the host's `tools/list`.

Use the official OAuth-protected Streamable HTTP endpoint:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Configure this URL using the MCP host's remote-server settings and complete its
secure OAuth flow. Example configuration, where supported by the host:

```json
{"mcpServers":{"call-e":{"url":"https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"}}}
```

Confirm `plan_call`, `run_call`, and `get_call_run` appear. For setup verification,
use only `plan_call` with an incomplete no-call request; never use `run_call` as a
connectivity test. Missing auth or missing tools blocks live dispatch, not local tests.

## Exact handoff

| Tool | Inputs used by this skill | Effect |
| --- | --- | --- |
| `plan_call` | `user_input` verbatim; known `to_phones`, `region`, `language`, `goal` | Prepares a plan only |
| `run_call` | Exact returned `plan_id` and `confirm_token` | Places one authorized call |
| `get_call_run` | Exact `run_id`; returned `cursor` if paging | Reads progress and results |

Do not send `result_schema` or `webhook_url` to these MCP tools; those are not
documented parameters. This skill performs its structured checking locally.
Prefer `structuredContent`; for compatibility, a JSON object may appear in any
text content block, not necessarily the first. Never synthesize opaque identifiers.

If `ready_to_run` is false, resolve the returned missing details before proceeding.
Save a run ID immediately after dispatch. Check after about 60 seconds, then follow
server `next_step` or poll every 5-10 seconds. Retain the run ID on a monitoring
timeout and resume reads; do not redial. If dispatch is ambiguous and no ID exists,
stop for operator review because this MCP contract has no general lookup operation.

Terminal outcomes include `COMPLETED`, `FAILED`, `NO_ANSWER` (or `NO ANSWER`),
`DECLINED`, `CANCELED`, `CANCELLED`, `VOICEMAIL`, `BUSY`, and `EXPIRED`. Completion
does not establish any business outcome. Unknown statuses remain unresolved.

## Transcript handoff

Preserve original provider-returned text. Normalize available turns to the helper's
`transcript` array only when speaker and turn boundaries are known. Do not silently
turn summaries into transcripts. The host selects candidate full-turn quotations
and field labels, then invokes `validate-result`; the checker does not perform an
LLM extraction, semantic entailment check, or independent provider verification.
Keep the raw provider response private for comparison. If speaker attribution or
source text is unavailable, report UNKNOWN instead of constructing evidence.

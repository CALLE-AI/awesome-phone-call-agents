# MCP Provider Route

Generated outbound phone-call skills use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

## Rules

- Use MCP tools exposed by the host for this route.
- Do not use a CLI bootstrap path.
- Do not invent MCP tool names, schemas, confirmation tokens, or run IDs.
- Stop before real calls when the route is unavailable, authentication is missing, or the host cannot call the route safely.
- Do not treat app connector tools, plugin tools, or `mcp__codex_apps__*` namespaces as proof that this MCP route is configured or authenticated.
- Pass full phone numbers only inside private execution payloads after validation and approval.
- Mask phone numbers in user-facing summaries.

## Creation-Time Provider Onboarding

Before writing a generated skill that can place real calls, verify the CALL-E MCP provider route during creation in the current host runtime. Record explicit evidence for:

- Provider host runtime, such as Codex, Claude, Antigravity, Cursor, or another MCP-capable agent host
- route availability for `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`
- MCP route setup check result from the selected host's MCP server or connector setup
- provider authentication or auth readiness check result from OAuth, managed connector auth, or the host's documented auth state
- compatible MCP plan, run, and status tools exposed by a fresh session for the configured route
- one-off call capability, not provider-side recurrence
- blocker and user action when authentication or compatible tools are missing

## Host Adapter Examples

Use the host's documented MCP setup and authorization mechanism. Do not ask the user for raw credentials or tokens.

### Codex adapter

Use this setup sequence when Codex is the selected host adapter and the Codex CLI is available:

```bash
codex mcp get calle-prod
codex mcp add calle-prod --url https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
codex mcp login calle-prod
codex mcp list
```

Skip `add` when `calle-prod` already exists with the required route. Skip `login` only when OAuth is already authenticated. If login requires browser completion, stop and wait for the user to finish it, then re-check.

### Claude, Antigravity, Cursor, or another MCP host adapter

Configure the MCP server or connector using that host's MCP UI, config file, CLI, or connector API. The route must be the CALL-E provider URL above, with the transport and authentication settings required by that host. Complete OAuth or managed authorization through the host's normal flow, then start a fresh agent session or refresh tools so compatible plan, run, and status tools are visible.

### Managed connector or app route

Use a managed connector only when the host documents that the connector is the MCP route setup and exposes authorization state for the route. Callable app tools or plugin namespaces alone are not proof that the MCP route is installed or authorized.

If no authenticated MCP route is available, stop and ask the user to connect or authorize it, then re-check. If provider auth or compatible tools still cannot be verified, record a provider onboarding blocker and keep the generated skill dry-run-only until the blocker is resolved.

Provider onboarding must remain non-mutating for phone-call side effects. Do not create provider plans, run calls, write results, expose credentials, or request confirmation tokens during onboarding.

## One-Off Provider Flow

Generated skills should follow this provider flow when compatible tools are available:

```text
auth readiness -> call plan -> plan inspection -> call run -> status check -> writeback
```

The plan inspection step must confirm:

- the destination phone number matches the validated candidate
- the generated goal matches the business contract
- the request is one-off and not a recurring provider schedule
- no credentials or confirmation tokens are exposed in user-facing summaries

If the MCP route returns a confirmation token or run identifier, keep it private unless the host documentation states that a run ID is safe to show.

## Approved Batch Flow

After the user approves the exact pending call list, generated skills should process candidates serially. After execution approval, do not ask the user to continue, confirm the next candidate, or approve additional provider runs. For each ready candidate, run the one-off provider flow to a terminal result or skip state, record the result, then move to the next candidate without asking for another per-candidate confirmation.

Provider terminal instructions such as `report_result` or `do not start another call` apply only to the current provider run. Treat them as protection against duplicate execution of the same plan, not as a command to abandon the approved batch.

Terminal seen is not terminal stable. Generated skills must run full-history provider reconciliation before writing results or reporting the final batch summary. Cursor-based polling may drive progress updates, but after terminal status appears, re-check the full provider run history without a cursor and with a high enough limit to include lifecycle events and conversation content when available.

Do not write negative terminal results such as `no_answer`, `failed`, or `no conversation captured` until a negative terminal stability check passes. If a later full-history recheck shows an answer, transcript, collected field, or stronger result, use that latest evidence for writeback.

If a candidate-level plan, run, or status check fails, record the failure and continue with the next ready candidate when it is safe to continue. Stop the batch only when the MCP route is unavailable, authentication is missing, required provider tools are unavailable, or continuing would create unsafe or duplicate calls.

After the final candidate is processed, generated skills must write configured results or output the session table, then report one final batch summary.

## Scheduled Runs

Recurring schedules belong to the host scheduler, not the provider route.

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

A scheduled generated skill run must still validate records, deduplicate candidates, and use the MCP provider route for only one call per approved candidate.

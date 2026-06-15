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
- Pass full phone numbers only inside private execution payloads after validation and approval.
- Mask phone numbers in user-facing summaries.

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

After the user approves the exact pending call list, generated skills should process candidates serially. For each ready candidate, run the one-off provider flow to a terminal result or skip state, record the result, then move to the next candidate without asking for another per-candidate confirmation.

If a candidate-level plan, run, or status check fails, record the failure and continue with the next ready candidate when it is safe to continue. Stop the batch only when the MCP route is unavailable, authentication is missing, required provider tools are unavailable, or continuing would create unsafe or duplicate calls.

After the final candidate is processed, generated skills must write configured results or output the session table, then report one final batch summary.

## Scheduled Runs

Recurring schedules belong to the host scheduler, not the provider route.

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

A scheduled generated skill run must still validate records, deduplicate candidates, and use the MCP provider route for only one call per approved candidate.

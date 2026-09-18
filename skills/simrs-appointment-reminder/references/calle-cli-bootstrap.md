# CALL-E CLI Bootstrap

## Finding the CLI

Use the first working command:

1. Repository-local: `node packages/cli/bin/calle.js`
2. Global install: `calle`
3. Pinned npx: `npx -y @call-e/cli@<version>`

### Detection Script

```bash
#!/bin/sh
# Detect available calle CLI command
if [ -f "packages/cli/bin/calle.js" ]; then
  echo "node packages/cli/bin/calle.js"
elif command -v calle >/dev/null 2>&1; then
  echo "calle"
else
  echo "npx -y @call-e/cli"
fi
```

## Auth Check

Before placing any call:

```bash
<cli-command> auth status
```

If `usable` is `false`, run:

```bash
<cli-command> auth login --start-only --no-browser-open
```

Then have the user open the `login_url` in their browser.

## Call Flow

```
auth status → call plan → call run → call status
```

### Plan

```bash
<cli-command> call plan \
  --to-phone "+6285929931919" \
  --goal "<call-goal-text>" \
  --language Indonesian \
  --timezone Asia/Jakarta
```

### Run

```bash
<cli-command> call run \
  --plan-id "<plan-id-from-plan>" \
  --confirm-token "<token-from-plan>"
```

### Status

```bash
<cli-command> call status --run-id "<run-id-from-run>"
```

## MCP Alternative

Instead of CLI, use MCP tools directly when the agent has CALL-E configured as an MCP server:

```json
{"tool": "plan_call", "arguments": {"user_input": "...", "timezone": "Asia/Jakarta"}}
{"tool": "run_call", "arguments": {"plan_id": "...", "confirm_token": "..."}}
{"tool": "get_call_run", "arguments": {"run_id": "..."}}
```

## Timeout Defaults

| Operation | Timeout |
|---|---|
| auth status | 15s |
| call plan | 15s |
| call run | 10min (call duration) |
| call status | 15s |

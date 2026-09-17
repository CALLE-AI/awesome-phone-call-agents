# The MCP server

Orma exposes six tools over MCP, the Model Context Protocol. The endpoint is
`https://orma-api.nryn.dev/mcp`. Any client that speaks Streamable HTTP can add,
read and retire items under exactly the same row-level security as the web app.

Verified live on 13 September 2026 with a throwaway account, which was deleted
afterwards. Every response below is one the probe actually received.

## Endpoint

| | |
|---|---|
| URL | `https://orma-api.nryn.dev/mcp` |
| Transport | Streamable HTTP, stateless |
| Auth | one header, `Authorization: Bearer <Supabase access token>` |

No `apikey` header on this surface. The server reads the caller's token, builds
a client with it and never uses a service role. A missing or expired token is a
clean protocol error, not a 500. The proxy maps `/mcp` and `/mcp/`, and
nothing deeper, so configure the bare URL.

## Getting a token

Take a password grant from Supabase auth:

```bash
curl -sS -X POST "${ORMA_API_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"<account email>","password":"<account password>"}'
```

`ORMA_API_URL` is the deployed front door, `https://orma-api.nryn.dev`.
`SUPABASE_ANON_KEY` is the project's publishable key from the Supabase
dashboard, under Project Settings, API keys. Neither value is a secret worth
guarding, but neither is printed here.

The response carries `access_token`, valid for one hour (`expires_in` 3600).
Repeat the grant for a fresh token when one expires.

The account must be a confirmed Orma user with a profile row. Orma provisions
accounts for now, and every provisioned account already carries its profile
row. Sign-up opens later with the web app. Without a profile row, the write
tools fail with a foreign-key error.

## Client configuration

Paste this into an MCP client that reads `mcpServers` JSON:

```json
{
  "mcpServers": {
    "orma": {
      "type": "http",
      "url": "https://orma-api.nryn.dev/mcp",
      "headers": {
        "Authorization": "Bearer <ORMA_ACCESS_TOKEN>"
      }
    }
  }
}
```

The only edit needed is replacing `<ORMA_ACCESS_TOKEN>` with the token from the
grant above. A client that prefers `url` over `type` takes the same values.

## The six tools

Each example shows the JSON-RPC request and the response observed on
13 September 2026. The tool payload arrives inside `result.content` as one text
block. The examples below show it parsed for readability.

### add_item

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_item","arguments":{"text":"dentist checkup"}}}
```

The response:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "text": "dentist checkup",
  "status": "open",
  "source": "mcp",
  "since_date": null,
  "created_at": "2026-09-13T14:09:30.824319+00:00",
  "retired_at": null,
  "retired_reason": null,
  "seeded": false
}
```

Rows written here always carry `"source": "mcp"`. `since_date` is optional and
takes `YYYY-MM-DD`.

### list_items

```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_items","arguments":{}}}
```

The response is an array of open items, same shape as the `add_item` row:

```json
[
  {
    "id": "22222222-2222-4222-8222-222222222222",
    "user_id": "11111111-1111-4111-8111-111111111111",
    "text": "dentist checkup",
    "status": "open",
    "source": "mcp",
    "since_date": null,
    "created_at": "2026-09-13T14:09:30.824319+00:00",
    "retired_at": null,
    "retired_reason": null,
    "seeded": false
  }
]
```

Retired items never appear here. Once an item is retired, the array no longer
carries it.

### retire_item

```json
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"retire_item","arguments":{"item_id":"22222222-2222-4222-8222-222222222222","reason":"handled this morning"}}}
```

The response:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "text": "dentist checkup",
  "status": "retired",
  "source": "mcp",
  "since_date": null,
  "created_at": "2026-09-13T14:09:30.824319+00:00",
  "retired_at": "2026-09-13T14:09:38.779+00:00",
  "retired_reason": "mcp:11111111-1111-4111-8111-111111111111:handled this morning",
  "seeded": false,
  "retired_by": "11111111-1111-4111-8111-111111111111",
  "retired_surface": "mcp",
  "reversible": true
}
```

The row keeps who retired it and through which surface, stored in
`retired_reason` as `mcp:<user id>` plus the optional note. `reason` is
optional.

### set_slot

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"set_slot","arguments":{"local_time":"08:30","part_of_day":"morning"}}}
```

The response:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "local_time": "08:30:00",
  "part_of_day": "morning",
  "weekdays": [1, 2, 3, 4, 5, 6, 7],
  "active": true,
  "created_at": "2026-09-13T14:09:31.292103+00:00"
}
```

`local_time` accepts `HH:MM` or `HH:MM:SS` and is stored with seconds.
`part_of_day` is `morning`, `midday` or `evening`. `weekdays` are the numbers
1 to 7 and default to every day. `active` defaults to true. Pass `slot_id` to
update an existing slot instead of inserting one.

### get_last_call

```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_last_call","arguments":{}}}
```

A fresh account has no calls, so the payload is `null`:

```json
null
```

Once calls exist, the payload is the latest `call_runs` row by `scheduled_for`,
with `state`, `disposition`, `mood` and the briefing among its fields.

### get_patterns

```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"get_patterns","arguments":{}}}
```

A fresh account has no analysis yet, so the payload is `null`:

```json
null
```

Once a pattern report exists, the payload is the latest `pattern_reports` row,
`facts` included, so an agent gets the numbers rather than only the prose.

## When it fails

The endpoint refuses a missing or expired token before any tool runs, with
HTTP 401:

```json
{"jsonrpc":"2.0","error":{"code":-32001,"message":"unauthorized: missing bearer token"},"id":null}
```

An expired or malformed token answers the same way, with message
`unauthorized: invalid or expired token`.

A row the caller does not own reads as not found, because row-level security
hides it. Retrying another user's `item_id` returns a tool error:

```text
retire_item failed: item not found, not open, or not owned
```

The same message covers an id that does not exist or an item already retired.

## Retiring is reversible

`retire_item` marks the item `retired` and records the surface and the caller,
so the list stays truthful without losing the line. Retired items stay
recoverable. Restores arrive with the web app at `orma.nryn.dev`. A restore
clears the status and the retired fields.

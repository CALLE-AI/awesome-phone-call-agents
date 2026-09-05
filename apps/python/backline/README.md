# Backline

Call suppliers for a price quote, rank what comes back by landed cost.

A small F&B or retail operator runs procurement over WhatsApp and phone calls:
notice stock is low, text three suppliers, get three replies in three
different formats, do mental arithmetic, pick one, forget to record it.
Backline is an agent that does this instead — it decides what to reorder,
calls suppliers in parallel through CALL-E, extracts a structured quote from
each transcript, and ranks the offers.

This directory is a focused, standalone extract of the CALL-E integration
piece of that larger project. The full project (a FastAPI backend, SQLite
persistence, an async orchestrator, and a React "Call Theater" UI that shows
a live transcript next to fields filling in as they're heard) is more than a
single runnable script, so it isn't reproduced here — this file shows the
part that plans a call, runs it, and polls for the result through CALL-E's
MCP tools (`plan_call` / `run_call` / `get_call_run`), which is the piece
directly relevant to this collection.

## Setup

Python 3.11+, standard library only for preview and `--simulate`.

```bash
cd apps/python/backline
python3 backline.py --fixture example-suppliers.json
```

Only `--execute` needs the MCP client:

```bash
pip install mcp httpx
```

## Three modes, and only one of them dials

| | places calls | needs credentials | what it is for |
|---|---|---|---|
| preview *(default)* | no | no | see who would be called, and why the rest would not |
| `--simulate` | no | no | the whole plan → run → poll pipeline against responses shaped exactly like a real completed call |
| `--execute` | **yes** | yes | the real thing |

### Preview

```text
PREVIEW -- NO CALL PLACED
Nothing was dialed. No credentials were read and no request was sent.

Item: 6 case of oat milk, 1L bottles, 12 to a case
Callable now: 2    Excluded: 1

1. Northgate Dairy Supply  +155***00  (English)
2. Riverside Wholesale Foods  +155***01  (English)

Not called:
   - Old Mill Distributors  555-**02  ->  not a valid E.164 number: 555-**02

Read that list. If it is who you meant to call:

    --simulate                         see the extraction pipeline, no calls
    --execute --confirm 5f068f1fc09c   place the calls
```

### Simulate

```bash
python3 backline.py --fixture example-suppliers.json --simulate
```

Runs the real plan/run/poll code path with the CALL-E transport swapped for
canned responses — but the canned responses aren't guesses. They're shaped
exactly like what the real API returned in a live, verified test call placed
against the production MCP server (`https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`)
on 2026-09-05: `result.transcript` is a ready-made, speaker-labelled string
(`[00:00:00] BOT: ...` / `USER: ...`), and `result.outcome` carries a
`completion_confidence` score and a plain-English `evidence` list. Getting
this shape right by actually placing a call — rather than inferring it from
the tool schema — caught real gaps: the schema alone doesn't tell you that
`get_call_run`'s transcript already comes back speaker-labelled, or that a
`next_step.action` of `ask_user_for_missing_info` can show up mid-run and
needs to be routed to a human, not treated as a failure.

### Execute

```bash
export BACKLINE_LIVE_CALLS_ENABLED=true
export BACKLINE_CALLE_MCP_URL=https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
export BACKLINE_CALLE_TOKEN_CACHE=/path/to/calle-mcp/token.json
python3 backline.py --fixture example-suppliers.json \
    --execute --confirm 5f068f1fc09c
```

**This dials real suppliers.** Independent gates stand in front of it, and
any one alone stops the call:

1. `BACKLINE_LIVE_CALLS_ENABLED=true` in the environment
2. `BACKLINE_CALLE_MCP_URL` and `BACKLINE_CALLE_TOKEN_CACHE` in the
   environment — the token itself comes from an external `calle-mcp` CLI
   login flow, which this script only reads, never performs
3. `--confirm <token>` — a token bound to this exact batch: the item and the
   sorted list of numbers. Change either and the old token stops working.
4. every number is validated as E.164 before it is dialled; a local or
   ambiguous number is rejected, never reformatted

## The confirmation token

The token is a hash of the item plus the sorted list of numbers. Re-run the
same fixture and get the same token back; add or remove a supplier and it
changes. A confirmation that survives a change in what it confirms is not a
confirmation.

## Safety

- **Preview is the default.** Nothing dials unless `--execute` and every gate
  passes.
- **The agent states it is an automated assistant** as the first line of
  every call goal, and is instructed to collect a quote only — never to
  commit to placing an order. Ordering, in the full project, is a separate,
  human-approved action that never happens during a call.
- **Never disclose one supplier's price to another** — part of the same
  scripted goal, not left to model judgement.
- **If asked for a human, or if the person sounds confused, end the call** —
  again, a hard rule in the goal text, not a suggestion.
- **Phone numbers are masked in every output path** — preview, simulate, and
  execute alike.
- **A local or ambiguous number is rejected, never reformatted.** Guessing a
  country code is how you call a stranger in another country.
- **This app has no cancel/hangup tool wired in**, because CALL-E's current
  tool set (`plan_call` / `run_call` / `get_call_run` / `track_ui_events`, as
  pulled live from the MCP server) does not expose one. Worth knowing before
  you rely on being able to stop a call once `run_call` has been invoked.

## Tests

```bash
cd apps/python/backline
python3 -m unittest test_backline.py -v
```

No test places a call, reads a credential, or opens a network connection —
masking, E.164 validation, confirmation-token stability, and the "never
commit to an order" wording in the call goal are all checked without one.

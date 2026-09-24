# The one real call

Evidence that `CallEProvider` works against the live CALL-E service, not just against
fixtures. Everything below is captured output from the run on **2026-09-12**, not an
illustration.

Required by the hackathon rules ("CALL-E imported and actually called at runtime, not
just referenced") and by [`submission-checklist.md`](submission-checklist.md). Tracked on
issue #9.

## What was run

```bash
cp .env.example .env     # CALLE_API_KEY + DEMO_SUPPLIER_PHONE filled in; .env is gitignored
npm run start:real       # node --env-file=.env src/server.js
```

**Re-running it today needs one more line in `.env`:** `CALLE_ALLOWED_DESTINATIONS`, set to
the same number as `DEMO_SUPPLIER_PHONE`. That allowlist was added after this run, in
response to the maintainer's second review on the upstream PR — the real provider now
dials nothing that isn't on it.

Then, from the dashboard at `http://localhost:3000`: **Plan Call** → **Approve** →
**Place Call**.

`CALL_PROVIDER=calle`, so `place_call` reached `CallEProvider` and
`https://api.heycall-e.com/v1/calls` — the fake provider was not involved at any point.
The supplier number is the owner's own phone, supplied via `DEMO_SUPPLIER_PHONE` and
masked below; it lives only in the untracked `.env`, and `task_1`'s seeded default stays in the
fictional `+1-555-01xx` block.

## Authentication, checked before dialing

CALL-E's documented read-only probe, which places no call and bills nothing:

```
$ curl -i "https://api.heycall-e.com/v1/goals?limit=1" -H "Authorization: Bearer $CALLE_API_KEY"
HTTP 200 OK
{"object":"list","data":[],"next_cursor":null}
```

## Activity log — the full audit trail

Every invocation, with its actor, exactly as `GET /api/activity-log` returned it:

| Timestamp (UTC) | Actor | Tool | Result |
|---|---|---|---|
| `2026-09-12T21:33:14.528Z` | `owner` | `plan_call` | completed |
| `2026-09-12T21:33:16.765Z` | `owner` | `approve_task` | completed |
| `2026-09-12T21:36:10.707Z` | `owner` | `place_call` | completed |

Three entries, no refusals, no retries — and `approve_task` is there as its own
human-actor step between planning and dialing, which is the entry's whole thesis
observable in the audit trail rather than only in the tests.

## The call

- **Dialled:** the owner's own phone (`+•••••50`, exactly as the API masks it), answered and played the supplier
- **Approved:** `2026-09-12T21:33:16.765Z`
- **Call finished:** `2026-09-12T21:36:10.707Z` — roughly **2m50s** end to end
- **Line region:** International. CALL-E routes `+91` (India) over its international
  numbers; see docs.heycall-e.com/regions

## Outcome, as it landed on the task

```json
{
  "outcome": "quoted",
  "summary": "Acme Corp provided a quote for WIDGET-42 quantity 100: unit price $10 per unit, lead time around 7 days, and minimum order quantity 50 units.",
  "next_action": "review_quote"
}
```

Task status: `completed`. Call record: `{"status":"done","updatedAt":"2026-09-12T21:36:10.707Z"}`.

The three fields are not parsed out of a transcript by this app — they are the
`result_schema` in `src/providers/calle-provider.js` handed to CALL-E, which extracts
and validates against it before returning. The schema asks for exactly the
`{outcome, summary, next_action}` shape the dashboard's Outcome card already renders,
so nothing translates between the two.

## What this run established that fixtures could not

1. **The integration is real.** Before this, `CallEProvider` had never touched the live
   service — and when it was first pointed at it, it did not work at all: it targeted an
   MCP host that rejects a static API key. That is fixed (#138) and this run is the
   proof.
2. **The call is genuinely asynchronous.** It took ~2m50s to reach a terminal state.
   A synchronous create-and-read would have returned nothing usable; the poll loop is
   load-bearing, not defensive.
3. **The in-flight strip is reachable after all.** `README.md` and
   [`video-script.md`](video-script.md) both record that `Dialing… / Connected /
   Wrapping up` never renders — true of the fake provider, whose default pacing resolves
   instantly. Against the real provider, with the dashboard polling `/api/state` every
   second, those transitions do appear on screen.

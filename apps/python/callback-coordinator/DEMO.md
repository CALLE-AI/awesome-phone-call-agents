# Callback Coordinator — Live Demo Setup

This walks you through running a **real CALL-E call** so you can verify the app
end-to-end and capture the ~3-minute hackathon demo video.

## Prerequisites

- Python 3.11+ with `uv` (or `pip`).
- Your **CALL-E API key** from the [dashboard](https://dashboard.heycall-e.com/account/api-keys).
- A **phone number you own or are authorized to call**, in E.164 format
  (e.g. `+12025550123`). Use your own mobile for the demo.

## 1. Install dependencies

```bash
cd apps/python/callback-coordinator
uv sync --dev        # or: python3 -m venv .venv && ./.venv/bin/pip install -r requirements...
```

## 2. Set your API key

Export it in your shell (never commit it):

```bash
export CALLE_API_KEY="<YOUR_KEY>"
```

## 3. Verify the key (no call placed)

```bash
uv run python client.py --request demo_request.json --check-api
```

Expected: `"healthy": true`, `"creates_phone_call": false`.

## 4. Put your phone number in the demo intake

Edit `demo_request.json` and set `"phone"` to your E.164 number, e.g.:

```json
"phone": "+12025550123"
```

## 5. Dry-run preview (no call)

```bash
uv run python client.py --request demo_request.json
```

This validates the intake and prints a masked plan with the quiet-hours gate.
The phone shows as `+12******123`. To force a "daytime" gate test regardless of
the wall clock:

```bash
uv run python client.py --request demo_request.json --now "2026-08-10T14:00:00-04:00"
```

## 6. Place one live call

```bash
uv run python client.py --request demo_request.json \
  --execute --confirm-consent --output demo_ticket.json
```

The agent will call your number, disclose it's AI, confirm you're the intended
recipient, ask why you're calling back, ask if it's urgent, and ask if voicemail
is okay if the human callback is missed. It **does not** offer to book a specific
callback time – that is out-of-scope for the triage schema. Then it writes a
fail-closed ticket.

## 7. Read the result

```bash
cat demo_ticket.json
```

You'll see a `disposition` of `scheduled`, `declined`, or `needs_human`, plus
the classified `contact_reason` and the `route_to` team. Example:

```json
{
  "disposition": "scheduled",
  "needs_human": false,
  "reason": "routed",
  "contact_reason": "billing",
  "urgent": "no",
  "route_to": "Billing Team",
  "status": "completed"
}
```

## Tips for the demo video

1. **Prep your number** and run step 3–5 once silently so the live call is clean.
2. **Screen-record** your phone's ringtone + the terminal running step 6.
3. Say a **reason on the call** (e.g. "I need help with an invoice") so the
   classifier has something to extract, then show `demo_ticket.json` routing it
   to the Billing Team.
4. To show **fail-closed safety**, run step 6 again and hang up immediately or
   answer with "I don't want a callback" — the ticket should come back
   `declined` or `needs_human`, not auto-closed.
5. To show the **quiet-hours gate**, add `--now "2026-08-10T22:00:00-04:00"` and
   note the engine refuses to dial (`disposition: skipped`).

## Reset

Each live call uses a stable `callback-triage-<workflow_id>` idempotency key.
Change `workflow_id` in `demo_request.json` for each new live call you intend to
make (or it will dedupe/replay against the same key).

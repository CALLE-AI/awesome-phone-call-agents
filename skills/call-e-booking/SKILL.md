---
name: call-e-booking
description: "Book restaurant tables or medical appointments via CALL-E AI voice calls. Load when the user wants to book, reserve, or schedule anything over the phone."
tags: [booking, voice, call, restaurant, medical, calendar, calle-ai]
---

# CALL-E Booking

Book restaurant tables and medical appointments via [CALL-E](https://heycall-e.com) — an AI voice agent that places real phone calls, has live conversations, adapts to unexpected responses, and returns schema-validated structured results you can feed straight into a calendar.

## What CALL-E is

CALL-E is a goal-driven AI voice agent, not a rigid script bot. You give it a natural-language goal (e.g. "book a table for 2 at 7pm at the restaurant you reach") + a phone number, and it plans the call, dials, holds a live conversation, and returns a structured result with per-attempt summaries and full transcripts.

This skill wraps the calle-ai Python SDK and orchestrates booking calls: gather parameters → show plan → confirm → dial → poll → result.

Install calle-ai in a Python 3.9+ venv.
Always run the scripts with that interpreter:

```bash
PY="./venv/bin/python3"
BOOK="./calle_booking.py"
SLOTS="./calendar_slots.py"
GAPI="<your-calendar-tool>"
```

Use `$PY $BOOK ...`, `$PY $SLOTS ...`, and `$PY $GAPI ...` everywhere below.

## Quick-start (the simplest path: --task)

The most generic entry point is `--task` — give it a goal + phone number and
CALL-E handles the rest. No `--kind`, no `--name`, no templates required:

```bash
# Preview
$PY $BOOK plan \
  --task "Call the dentist and book a teeth cleaning for Thethela Faltein next Tuesday morning. Budget is $300." \
  --phone "+12125551234"

# Execute
$PY $BOOK book --confirm \
  --task "Call the dentist and book a teeth cleaning for Thethela Faltein next Tuesday morning. Budget is $300." \
  --phone "+12125551234"
```

The `--task` flag bypasses all templates. The task text IS the instruction
CALL-E receives. The structured template flags (`--kind`, `--name`,
`--party-size`, `--reason`, `--date`, `--time`) still work when you prefer
structured input, but `--task` is the simplest path for any booking type.

## Quick-start (the agent runs this for you)

When the user says "book a table at [restaurant] for [N] at [time]," the agent:

1. **Gather** any missing details — the business phone number, the user's name, callback number, email, and any special requests. Load identity from the user's Hermes memory (name, email, location) and `.env` (caller phone number).
2. **Plan** — run `calle_booking.py plan ...` to build and preview the exact task + recipient + result schema. This is a dry-run with NO network call. Show it to the user.
3. **Confirm** — wait for explicit user approval. Never dial without it.
4. **Book** — run `calle_booking.py book --confirm ...`. This calls `calls.create()` then `calls.wait_for_result()` — the explicit split preserves the `call_id` so a timeout doesn't lose the reference (recover with `status --call-id <id>`). Polls every 5s (default) until terminal. Returns machine-readable JSON with `structured_result`, `attempts` (summary + transcript per attempt), and `completion_confidence`.
5. **Calendar** — if `structured_result.booked` is `true`, create a Google Calendar event via the `google-workspace` skill (`gws` CLI: `$PY $GAPI calendar create ...`). The result's `date`/`time` are **business-local**, not user-local: resolve the business timezone from the phone's area code (or add a `timezone` field to the result schema) and pass that offset — Google then renders it in the user's timezone automatically.
6. **Deliver** — summarize the confirmation (or failure) and deliver to the user. If triggered from Telegram, reply auto-routes back there. For background/cron bookings, set `deliver` to Telegram.

## Manual usage (debugging)

```bash
PY="./venv/bin/python3"
SCRIPT="./calle_booking.py"
SLOTS="./calendar_slots.py"

# Dry-run: preview without dialing
$PY $SCRIPT plan --kind restaurant --phone "+14155551234" \
  --date 2026-08-20 --time 19:00 --party-size 2 \
  --name "Your Name" --caller-phone "+14155550000" --email you@email.com

# Actually dial (--confirm is required)
$PY $SCRIPT book --confirm --kind restaurant --phone "+14155551234" \
  --date 2026-08-20 --time 19:00 --party-size 2 \
  --name "Your Name" --caller-phone "+14155550000" --email you@email.com --pretty

# Fire-and-forget: exit immediately, poll with `status` later
$PY $SCRIPT book --confirm --kind restaurant --phone "+14155551234" \
  --date 2026-08-20 --time 19:00 --party-size 2 \
  --name "Your Name" --caller-phone "+14155550000" --email you@email.com --no-wait

# With webhook: CALL-E POSTs the result to your endpoint (implies --no-wait)
$PY $SCRIPT book --confirm --kind restaurant --phone "+14155551234" \
  --date 2026-08-20 --time 19:00 --party-size 2 \
  --name "Your Name" --caller-phone "+14155550000" --email you@email.com \
  --webhook-url "https://your-server.com/call-e-webhook"

# Check an in-flight / completed call (read-only, no dialing)
$PY $SCRIPT status --call-id cal_... --events --pretty

# Free-slot availability (variant A)
$PY $SLOTS --source google --days 3 --pretty
```

For medical appointments, swap `--kind medical` and use `--reason "GP visit"` instead of `--party-size`.

## Generic booking kinds

`--kind` is **optional when `--task` is provided** (defaults to `generic`).
When you do pass it, it accepts **any** value, not just `restaurant` / `medical`:

- **Raw task** — pass `--task "..."` for the fully generic path. The task text
  is the entire instruction; `--kind` defaults to `generic` and the generic
  result schema is used. This is the recommended entry point for anything that
  isn't a standard restaurant/medical booking.
- **Built-in templates** — `restaurant` (needs `--party-size`) and `medical`
  (needs `--reason`) produce tailored task text + result schema.
- **Generic fallback** — any other `--kind` (e.g. `salon`, `garage`, `vet`,
  `hotel`, `contractor`) uses a generic template:
  *"Book a {kind} at the business reached at {phone}…"* and the generic result
  schema (`booked`, `date`, `time`, `business_name`, `confirmation_number`,
  `notes`, `timezone_offset`). Extra detail goes in `--notes` (or `--reason`).
- **Fully custom schema** — pass `--schema-file path/to/schema.json` and the
  result schema becomes whatever JSON Schema you provide, for any booking type
  imaginable, without editing this script.

```bash
# Generic: book a vet appointment
$PY $SCRIPT plan --kind vet --phone "+141****1234" --name "Jane Doe" \
  --date 2026-08-20 --time 10:00 --reason "cat annual checkup"

# Fully custom: a garage/valet booking with its own schema
$PY $SCRIPT plan --kind garage --schema-file ./valet_schema.json \
  --phone "+141****1234" --name "Jane Doe" --notes "car reg CA 123-456"
```

## Architecture

```
Skill (SKILL.md) — orchestrates the workflow:
  ├── Memory — user's identity (name, email, location)
  ├── .env — CALLE_API_KEY + caller phone
  ├── phone-scout → upstream research (discovers businesses, phone-verifies info)
  ├── scripts/calle_booking.py — wraps calle-ai SDK
  │     ├── plan    (dry-run, JSON preview, no network)
  │     ├── book    (dial + poll, requires --confirm)
  │     └── status  (read-only, any existing call)
  ├── google-workspace → gws calendar create
  └── Hermes gateway → Telegram delivery
```

## Configuration for non-SA users

`calle_booking.py` is not hardcoded to any location or currency. The generic
template (`--kind vet`, `--kind salon`, etc.) works for any booking type. Key
environment variables:

| Variable | Purpose |
|---|---|
| `CALLE_API_KEY` | CALL-E API key (required for `book`) |
| `BOOKING_PHONE` | Your callback number, given to businesses |

No location-specific defaults — phone numbers are E.164, dates are ISO 8601,
and the generic booking template adapts to whatever `--kind` you pass.

## Prerequisites

- **CALL-E account**: sign up at https://heycall-e.com (20 free calls to start).
- **API key**: get from https://dashboard.heycall-e.com/account/api-keys. Store in `your environment file`:
  ```
  CALLE_API_KEY="iams_live_..."   # key prefix varies (iams_live_, calle_live_, etc.)
  ```
- **Callback number**: store your phone number in `your environment file`:
  ```
  BOOKING_PHONE="+27XXXXXXXXX"
  ```
- **Python SDK**: installed in the skill's own venv (Python 3.9+). See references/venv-setup.md. All scripts run via `$PY $SCRIPT`.
- **Google Calendar**: the `google-workspace` skill must be fully OAuth-authenticated (missing `google_token.json` or `google_client_secret.json` = blocked).
- **Telegram**: Hermes gateway must have the Telegram channel wired.

## Safety rules

1. **Never dial without explicit user confirmation.** `calle_booking.py book` requires `--confirm`. The plan must be shown and approved first.
2. **Real phone calls.** Always remind the user that `--confirm` will place a real outbound call to the number shown.
3. **Medical calls are higher risk** — strict IVRs, hold queues, privacy/consent rules. Test the pipeline on restaurants first.
4. **Cost.** 20 free calls, then paid. Check the CALL-E dashboard for pricing.

## Identity

The user's name, email, and location should live in agent memory. Their caller-number (callback number given to the business) goes in `your environment file` as `BOOKING_PHONE`. These are loaded by the skill during the gather phase — the skill should never hardcode PII in its body.

## Calendar availability (variant A: book within free windows)

⚠️ **Unreadable calendar = unknown, not all-free.** If the calendar source
is unavailable (e.g. TCC gate, expired OAuth token), treat availability as
**unknown** and require the user to provide explicit windows or a preferred
date/time. Never assume all time is free.

⚠️ **Results are advisory until confirmed.** After the call returns a
booked date/time/timezone, the agent MUST present it to the user for
confirmation before writing it to any calendar. Do not mutate the calendar
without explicit human sign-off on the specific slot/timezone.


Instead of a hard `--date`/`--time`, read the user's calendar to find free
windows and inject them into the task so CALL-E negotiates within them.
Reading the user's calendar gives the *user's* free times only — the business
has its own openings that only the call resolves — so inject the windows and
let CALL-E find a slot inside them (don't hard-demand one time).

- `scripts/calendar_slots.py --source google|apple --from <date> --days N` emits `{"free_slots":[{"start","end"},...]}`.
- Pipe it straight into `calle_booking.py --free-slots "$FREE"` (accepts either the array or the full `calendar_slots.py` object).
- Google source: `google_api.py calendar list` (needs `google-workspace` OAuth).
- Apple source: `osascript` reading Calendar.app (see TCC pitfall; degrades to "all free" if unreadable).
- Window formats accepted: full ISO `{"start","end"}`, or shorthand `{"date","start","end","timezone"}`.

## Research calls (use phone-scout, NOT calle_booking.py)

Do NOT repurpose `calle_booking.py` for research, availability checks, or price
inquiries. `calle_booking.py` makes reservations — it books things. For researching
businesses by phone (calling to ask questions without making a booking), use the
`phone-scout` skill instead:

```bash
# WRONG — calle_booking.py is for bookings, not research
# $PY $BOOK book --confirm --task "check availability..."

# CORRECT — phone_scout.py owns research calls
python3 phone_scout.py \
  call-one --candidate-id rest-001 --phone "+27..." --name "Restaurant" \
  --research-questions availability vegetarian_options price
```

The two skills have clean separation:
- **`phone-scout`** — researches businesses (discovers candidates, calls them for info, ranks results). Information gathering only — no reservations.
- **`call-e-booking`** — books businesses (makes confirmed reservations, writes to calendar). Reservations only — no research.

If you find yourself writing a custom `--task` to `calle_booking.py` that asks
questions instead of making a booking, you are in the wrong skill. Load `phone-scout`.

## Interactive flow (terminal, desktop, or any gateway)

The same workflow runs as a multi-turn conversation on any surface — CLI, TUI,
desktop app, Telegram, Discord, etc. The agent drives the conversation; the
scripts stay one-shot commands behind it.

Conversation pattern:

1. **User** — "book a table for 2 tonight at Kettle Steak" (or "book me a GP
   appointment").
2. **Agent gathers** missing details: business phone number, date/time, party
   size / reason, special requests. Loads identity from memory (name, email,
   location) and `.env` (`BOOKING_PHONE`). If the user says "when I'm free",
   compute windows: `$PY $SLOTS --source google --days N`.
3. **Agent previews** the plan (`$PY $BOOK plan ...`) and shows the user the
   exact task + the number that will be dialed.
4. **Agent confirms** — "Reply YES to place this call." Never dial before this.
5. **Agent books** — `$PY $BOOK book --confirm ...` (blocks until terminal, or
   `--no-wait` to background it).
6. **Agent finishes** — parses `structured_result`, writes the calendar event,
   replies with the confirmation (date, time, place, reference number).

Notes:

- The confirmation gate is **text-based and surface-agnostic** — a plain "YES"
  works on every gateway, no buttons required.
- On Telegram/gateway, the reply auto-routes to the triggering chat. On the
  terminal/desktop, it prints in the session.
- For a long call, use `--no-wait` + `status --call-id` (or a cron poller) so
  the conversation isn't blocked for minutes.

## Delegating a booking (delegate_task)

For long-running calls, parallel bookings, or keeping the parent conversation
clean, delegate the execution step to a sub-agent. The
parent still does the interactive gather → plan → confirm; the subagent runs
the dial (and calendar write) and reports back.

Single booking:

```
# Spawn a sub-agent (platform-specific):
  goal="Place the CALL-E booking and return the structured result.",
  context=(
    "Run this command and return the JSON `structured_result` (booked, date, "
    "time, party_size, restaurant_name, confirmation_number):\n\n"
    "PY=./venv/bin/python3\n"
    "BOOK=./calle_booking.py\n"
    "$PY $BOOK book --confirm --kind restaurant --phone \"+1...\" "
    "--name \"Thethela Faltein\" --party-size 2 --caller-phone \"+27...\" "
    "--email \"...\" --pretty\n\n"
    "The script auto-loads CALLE_API_KEY from your environment file.\n"
    "If booked=true, also create the Google Calendar event:\n"
    "$PY <calendar-tool> "
    "calendar create --summary \"Reservation at <name>\" --start <iso> "
    "--end <iso> --location <name>\n\n"
    "Return a one-line summary: place, date, time, confirmation number."
  ),
)
```

Parallel bookings (up to 3 concurrent by default):

```
# Spawn sub-agents (platform-specific):
  {"goal": "Book a table at <venue A>", "context": "<full command for venue A>"},
  {"goal": "Book a table at <venue B>", "context": "<full command for venue B>"},
  {"goal": "Book a table at <venue C>", "context": "<full command for venue C>"},
])
```

Rules:

- **Gather + confirm in the parent FIRST.** Subagents cannot ask the user (no
  so collect every detail and get explicit approval before
  delegating. The subagent runs `book --confirm` with approval already given.
- **Pass everything in `context`.** Subagents have no memory of the
  conversation — include identity, the exact command, and file paths.
- **Not durable.** A delegated child is process-local; if the parent session
  exits, the child is lost. For work that must survive, use a cron job +
  `--no-wait` + `status --call-id` instead.
- The subagent's summary is a self-report — verify the calendar event was
  actually created (re-run `calendar list`) before telling the user it worked.

## Handling outcomes (booked, not-booked, alternatives, failures)

The `structured_result` and each `attempts[]` element tell a story. Here's the
full decision tree the agent must follow after `book --confirm` finishes:

### booked = true (success)

The reservation or appointment was confirmed. Proceed to the calendar write.
If `date`/`time` differ from the user's original preference (the business only
had a different slot) — write that slot, note the difference, and confirm the
user is OK before creating the event.

### booked = false (business declined or could not book)

CALL-E spoke to someone but could *not* make a booking. Reasons include:

- **No availability at all.** The business is fully booked. CALL-E should have
  asked for the closest alternatives — they appear in `attempts[].summary` or
  `notes` as "they have Tuesday 19:00" / "next available is Monday 14:00".
  Report these alternatives to the user and offer to re-book at one of them.
- **Wrong number / not a restaurant or clinic.** The call connected but the
  business doesn't do bookings. Report verbatim; suggest the user verifies the
  number.
- **Language / communication failure.** The business couldn't take an English
  booking or the AI couldn't navigate the conversation. Check
  `attempts[].summary` + `failure_message`. Offer to retry with a different
  approach (e.g. `--notes "speak slowly, use French as fallback"`).

### Call never dialed / no contact

If `status` is `failed` or `attempts[].status` is `failed` / `canceled`,
nobody picked up. Check `attempts[].failure_code` and `failure_message`:

| Signal | Meaning | Action |
|---|---|---|
| `failure_code` = `voicemail` or `no_answer` | Unanswered / voicemail | Report: "Nobody answered. Try again later or try a different number?" |
| `failure_code` = `operator_intercept` or `call_blocked` | Carrier/call blocking | Report; the number or region may not be reachable |
| `failure_code` = `ivr` or `call_screening` | Automated system blocked the AI | Report; this happens often with medical clinics. Suggest calling again at a different time |
| `timeout` occurs (`--no-wait` path, or wait exceeded) | Call created but never terminal | Use `status --call-id <id>` to inspect; the call may still be in `queued` or `in_progress` |

### Retry with different parameters

When the agent retries, it **must change a flag** so the idempotency key
changes (otherwise CALL-E returns the *same* call). Options:

- `--notes "retry #2 — ask for Tuesday instead of Friday"`
- `--date 2026-08-25 --time 19:00` (hard-schedule the alternative slot)
- `--free-slots '<updated windows>'` (narrow or shift windows)

### No contact at all (status = queued / never reached dialing)

If the call sits in `queued` indefinitely (e.g. unsupported region like +27
was), report the likely cause (region support, downstream carrier) and suggest
waiting for CALL-E to enable the region. The call will auto-cancel after
CALL-E's own timeout.

### The retry loop (agent pattern)

If the business has no availability and the user wants to try alternatives,
the loop is:

1. Read the alternatives from `attempts[].summary` or `notes`.
2. Show them to the user.  
3. If the user picks one → re-plan with the new target date/time, get
   re-confirmation, then `book --confirm` again.
4. If the user rejects all → suggest widening the date range or trying a
   different venue. Offer to use `--free-slots` with more days.

For a fully-automated retry (no user in the loop), use a cron job: `--no-wait`
+ `status --call-id` polling every 60s, and when `booked == false`, run the
retry with bumped parameters and a fresh idempotency key.

## Pitfalls
- **Async duration** — a real call takes 1–3+ minutes. The `book` subcommand blocks with polling. Increase `--timeout` (default 900s) for long hold times.
- **Call framing** — CALL-E's task validator requires transparency from the start. The task must state upfront that this is an information-gathering call. The working pattern: "Hi, I'm calling to ask a few questions about [service] on [day] — this is just for research, I'm not making a booking today," ask the questions, then close with "As mentioned, this is just research. My client will call back if they decide to book." Identify as "an assistant" (never "AI assistant" or "bot"). The phone_scout.py task builder encodes this exact pattern. Detailed live-test data + SDK paths in `references/live-calle-pitfalls.md`.
- **Shared-line concurrency limit = 1.** CALL-E's default shared line allows only ONE active outbound call at a time (shared across API, MCP, and Dashboard). Firing N parallel calls makes N-1 fail with *"account concurrency limit of 1"* or *"call plan could not be prepared."* To unlock up to 10 concurrent calls, complete KYC and purchase a dedicated number at https://dashboard.heycall-e.com/account/numbers/buy. Until then, serialize calls — one `call-one` or `book --confirm` at a time. This is the root cause of the earlier +1 parallel-call failures; they were hard concurrency limits, not transient backend errors.
- **+27 (South Africa) support is prefix-dependent.** Confirmed working: **+27 87** (Sorbet Man Sandton City, full transcript). Blocked: **+27 11** (JHB landline), **+27 21** (Cape Town), **+27 78**. Error: *"Calls to South Africa in English aren't currently supported."* CALL-E is in active +27 rollout — test one number first before a multi-call SA research run.
- **IVR / call screening** may block the AI voice. Check `attempts[].failure_code` and `failure_message` when `booked` is `false`.
- **Idempotency** — the script derives a deterministic idempotency key from the full request (SHA-256 hash). Re-running the identical command within CALL-E's key TTL returns the SAME call (no double-booking). Changing any flag creates a new key and a new call.
- **Phone format** — E.164 with country code (`+14155551234`). Local numbers without `+` are rejected.
- **Timezone** — always pass `--timezone` so CALL-E disambiguates the time. The structured result `date`/`time` are in business-local time.
- **Cross-timezone calendar write** — when the business is in a different timezone than the user (verified: a US restaurant `+1 917` booked from SAST), the business-local `date`/`time` must be written with the *business* offset (derive from the area code, e.g. `+1 917` → `America/New_York`), NOT the user's location. Google Calendar converts to the user's timezone automatically. The clean fix is to add a `timezone` field to the `result_schema` so CALL-E reports the business's IANA tz instead of guessing from the number.
- **Structured result can be null** — if CALL-E could not produce a schema-valid result, `structured_result` is `null` even if the call ran. Check `attempts[].summary` and `task_completed` as fallback signals.
- **`datetime.fromisoformat` requires seconds** — `"18:30"` raises `Invalid isoformat string`; normalize `HH:MM` → `HH:MM:00` before parsing (the `--free-slots` shorthand pads this automatically).
- **Apple Calendar via `osascript` is TCC-gated** — on modern macOS, AppleScript automation to Calendar returns "Application isn't running" until the terminal has Automation permission (System Settings → Privacy & Security → Automation). `calendar_slots.py` handles this by degrading to "no events" (all free) with a stderr warning. `~/Library/Calendars/` may be empty for Google-only users.

- **`environment auto-load in background processes** — `calle_booking.py` uses `_load_dotenv()` to read `your environment file` at startup, so `CALLE_API_KEY` and `BOOKING_PHONE` are available even when the shell didn't source it first. Some runtimes don't inherit parent exports — this ensures the key is available. Never remove this call.
- **Timeout ≠ call failure** — if `book` exits with "Timed out waiting for call", the call was *created* successfully (it has a `call_id`) but never reached a terminal state. Reasons include: unsupported destination region, voicemail, or no answer. The script prints the `call_id` on timeout — run `$PY $BOOK status --call-id <id>` to inspect the actual state. The explicit `create()` + `wait_for_result()` split (instead of the old `create_and_wait` one-shot) ensures `call_id` always survives a timeout.

## References

- `references/result-schemas.md` — the restaurant and medical JSON Schema specs CALL-E validates against
- `references/sdk-api.md` — calle-ai SDK method signatures, call lifecycle, and model reference
- `references/venv-setup.md` — Python venv pattern for skills that need packages on macOS (PEP 668)
- `references/live-calle-pitfalls.md` — live CALL-E testing learnings: +27 instability, +1 parallel-call failures, task validation, SDK data paths, schema strictness, discovery data quality, disclosure patterns

## Scripts

- `scripts/calle_booking.py` — the main booking CLI tool (`plan`, `book --confirm`, `status`). Supports `--free-slots` (variant A), `--kind <any>` (any vertical — vet, salon, garage, ...), `--schema-file` for custom JSON Schema result schemas, `--no-wait` / `--webhook-url` for fire-and-forget, and a lazy SDK import so `plan` works without `calle-ai`/API key.
- `scripts/calendar_slots.py` — emits free time windows from Google (`gws`) or Apple (`osascript`) calendars; pipe its JSON into `calle_booking.py --free-slots`.
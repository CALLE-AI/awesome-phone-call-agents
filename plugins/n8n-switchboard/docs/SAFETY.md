# Safety

This package can place real outbound phone calls. Read this before using it.

## The specific risk

`run_call` is annotated `destructiveHint: true` in CALL-E's MCP tool list. That
means irreversible and side-effecting. A wrong database write can be rolled back.
A wrong phone call cannot: someone's phone rang and a synthetic voice spoke to
them.

CALL-E issues a `confirm_token` from `plan_call` and requires it for `run_call`.
That is a gate. But in a workflow host, the plan node's output is normally wired
straight into the run node's input, so the token travels between them in
milliseconds and no human is involved. The gate exists and is bypassed by default.

## What Switchboard does about it

The `confirm_token` is written to the job store and is never emitted into
workflow data. The node's output carries `hasConfirmToken: true` instead of the
value. `runner.dial()` is the only function that spends it, it refuses unless the
job status is `approved`, and it nulls the token immediately after use.

## Controls

All policy checks run before planning, and run **again** immediately before
dialing. A call approved at 8pm and dialed at 10pm still hits quiet hours.

| Control | Behaviour |
|---|---|
| Region | CALL-E supports a fixed recipient region list. Anything else is refused locally, before CALL-E is contacted. |
| Blocklist | `SWITCHBOARD_BLOCKLIST`, comma separated. Checked first. |
| Quiet hours | `SWITCHBOARD_QUIET_START` / `_END`. No dialing inside the window. |
| Rate limit | `SWITCHBOARD_MAX_CALLS_PER_RECIPIENT_PER_DAY`, default 2. Catches runaway loops. |
| Token expiry | `confirm_expires_at` is checked at dial time. Approving is not the same as approving in time. |
| Kill switch | Cancels every pending and approved job at once. |
| Dry run | Builds and displays the exact payload. Contacts nothing. |

## Modes

- `require_approval` (default). A human must approve in the console.
- `dry_run`. Nothing is sent. Use this for the whole of development.
- `auto`. No human gate. Policy checks still apply. Choose this deliberately.

## Cancellation

CALL-E ships no cancel tool. `plan_call`, `run_call`, `get_call_run` and
`track_ui_events` are the whole surface. Once a run is submitted there is no
documented way to stop it.

So cancellation in Switchboard means two different things, and the difference
matters:

- **Before dial.** The token is discarded and no call is ever placed. This is a
  real cancellation.
- **After dial.** Switchboard stops tracking the job. **The call may still
  happen.** Switchboard cannot recall it, and neither can anything else.

Do not read a cancelled job as a call that did not occur if `run_call_sent`
appears in its audit trail.

## Credentials

Read from environment variables at runtime. Never written to the job store, the
audit log, or node output. Authentication is delegated entirely to the `calle`
CLI's own cached login; this package holds no CALL-E credentials of its own.

## Consent

Switchboard enforces mechanics, not legality. It cannot tell whether the person
you are calling agreed to be called. Consent, disclosure that the caller is
automated, recording law, and calling-time regulations remain your
responsibility.

## Data

The job store is a plain JSON file at `data/jobs.json`, deliberately inspectable.
It contains phone numbers, goal text, transcripts and summaries. It is
gitignored. Treat it as personal data and delete it when you are done.

Tests write to `data/test-jobs.json` and never touch the live queue.

## What this does not protect against

- A human approving without reading. At high volume this is likely.
- A call that is polite, on time, in-region and still wrong.
- Anything after `run_call` has been sent.

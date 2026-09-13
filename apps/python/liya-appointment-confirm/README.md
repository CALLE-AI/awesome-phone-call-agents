# liya-appointment-confirm

Confirms one existing appointment by phone, using [CALL-E](https://docs.heycall-e.com),
and returns a structured yes/no plus any alternate time the recipient
proposed — as either a one-shot CLI command or three importable Python
functions.

Extracted from a larger personal desktop assistant ("Liya") down to just
the CALL-E calling capability, so the contribution here is scoped,
reviewable, and reusable on its own — no unrelated assistant tooling
(browser control, screen reading, dev tooling, etc.) is included.

## What it does

Given a task description and a phone number, it:

1. Validates and normalizes the phone number (E.164) *before* any network
   call, catching the most common real-world failure mode: a bare local
   number (e.g. a 10-digit Indian mobile number typed without `+91`)
   getting misread as a different country's number entirely.
2. Shows a preview of exactly what will be sent — recipient (masked in
   the printed preview), task, region, and result schema — before doing
   anything.
3. Places the call through CALL-E's Calls API and polls for a result.
4. Reports back a structured result: whether the recipient confirmed,
   why not if they declined, and any alternate time they proposed.
5. If the call fails, looks past CALL-E's generic "recipient may be busy"
   message for a sharper signal: an attempt that fails in under two
   seconds with a carrier-level error code means the number itself was
   unreachable (wrong digit, disconnected, not a real line) — not that
   the person was busy.

## Setup

```bash
pip install -r requirements.txt
export CALLE_API_KEY=sk_...          # from your CALL-E account
# export CALLE_BASE_URL=...          # optional, defaults to https://api.heycall-e.com
```

Get a CALL-E account (with 20 free calls) by following the
[CALL-E Integrations install guide](https://github.com/CALLE-AI/call-e-integrations).

## Usage

**Preview only — validates the number and shows what would be sent. Makes
no network request and places no call:**

```bash
python confirm_call.py \
  --task "Confirm the 10am appointment tomorrow" \
  --phone +12025550123 --region US \
  --dry-run
```

**Place the real call** (prompts for a typed `YES` first, since this has
a real-world side effect — a phone actually rings):

```bash
python confirm_call.py \
  --task "Confirm the 10am appointment tomorrow" \
  --phone +12025550123 --region US
```

**Skip the interactive prompt** (e.g. for scripting):

```bash
python confirm_call.py --task "..." --phone +1... --region US --yes
```

**Check a call you already placed**, instead of placing a new one:

```bash
python confirm_call.py --check call_abc123
```

See [`examples/sample_run.md`](examples/sample_run.md) for a full
annotated run using a fictional number.

## Side effects

- Placing a call (without `--dry-run`) makes a real outbound phone call
  through CALL-E and consumes one call from your account's allotment.
- No recurring job, webhook listener, or background process is created —
  this is a single one-shot call per invocation.
- Results are only ever printed to stdout; nothing is written anywhere
  except the small local dedupe-state file described below.

## Duplicate-call protection

Placing a call to the same number twice within 10 minutes is blocked by
default (a local state file at `~/.liya_appointment_confirm/recent_calls.json`
tracks the last call per number), since that pattern is far more often an
accidental double-run than a deliberate second call to the same person.
Pass `--force` to override when a second call really is intended.

## Cancellation

There is no recurring job to cancel — each invocation places at most one
call. Once a call has been placed and is ringing, CALL-E does not expose
a way to abort it mid-call from this app; the only "cancellation" point
is the interactive `YES` prompt before dialing (or simply not passing
`--yes`/typing `YES`).

## Credential handling

The only credential this app reads is `CALLE_API_KEY` from the
environment — nothing is written to disk, logged, or included in the
call preview. Do not commit a real key; there is no `config/` file or
committed secrets anywhere in this app.

## Notes on the phone numbers used in examples

All phone numbers in this README and in `examples/` are fictional
reserved-for-media numbers (`+1 202 555 01XX`), per the source
repository's requirement to use fictional or masked numbers in samples.

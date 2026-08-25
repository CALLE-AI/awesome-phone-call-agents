# Codex Call Reminder

Portable phone-call reminder skill for Codex CLI agents. Schedules outbound reminder calls via CALL-E SDK with explicit consent, dry-run safety, and cancellation support.

## When to use

- User asks an agent to remind someone by phone call
- Recurring or one-off appointment/confirmation/follow-up reminders
- Workflow needs a safe, auditable phone-call reminder primitive

## Prerequisites

- CALL-E API key in environment (`CALLE_API_KEY`)
- Phone number in E.164 format
- Explicit user consent before placing any real call

## Usage

```bash
# Dry run (no real call placed)
python3 scripts/remind.py --to +15550001234 --message "Appointment tomorrow at 3pm" --dry-run

# Real call (requires confirmation)
python3 scripts/remind.py --to +15550001234 --message "Appointment tomorrow at 3pm" --confirm
```

## Safety

- Always default to `--dry-run` unless `--confirm` is explicitly passed
- Never store phone numbers in logs; mask to last 4 digits
- Cancellation: `python3 scripts/remind.py --cancel <call-id>`
- No medical, legal, financial, or emergency content without human review

## Side effects

Places an outbound phone call when `--confirm` is used. Creates a scheduled job for recurring reminders. Both are cancellable.

## Host compatibility

Tested with Codex CLI. Compatible with any Agent Skills host that supports Python subprocess execution.

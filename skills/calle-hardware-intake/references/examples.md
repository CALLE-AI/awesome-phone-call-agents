# Examples

Fictional numbers only (`+15550101234` is a reserved fictional example).

## Example 1 — repair intake (leads to a ticket)

Goal:

```
Call the customer to intake a hardware repair request. Ask what device is
having problems, what the issue is, and whether it is urgent. Let the customer
describe the problem; do not schedule anything. Thank them and end the call.
```

Plausible transcript:

```
[00:00] BOT: Hi, I'm calling to collect details for a hardware repair request.
[00:05] USER: Hi, my laptop won't turn on after a Windows update.
[00:08] BOT: Which device is it, and how urgent is this?
[00:11] USER: A Dell laptop. It's urgent — I work from home.
[00:14] BOT: Thank you, I've noted that. Goodbye.
```

Result: Gemini calls `create_repair_ticket(device_type="laptop", ...)` and the
backend logs a ticket.

## Example 2 — appointment confirmation (no ticket)

Goal:

```
Call and confirm tomorrow's 10:30am laptop diagnostic appointment. If they
confirm, thank them and end the call. If nobody answers, leave a short
voicemail.
```

Outcome: CALL-E returns a summary ("the appointment was confirmed") and Gemini
correctly creates **no** ticket because no repair issue was described.

## Example 3 — status check

Goal:

```
Call and ask whether the customer has the ticket number for their in-progress
repair, and check the current status.
```

`check_repair_status` is invoked when the caller references an existing ticket
number or id.

## No-call paths

- `POST /api/intake {"transcript": "..."}` — parse any text into a ticket without
  any phone call.
- `python scripts/test_call.py +15550101234 "<goal>" --dry-plan` — plan only,
  never dial.

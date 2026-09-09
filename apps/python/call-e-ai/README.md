# CALL-E AI — Local Phone-Call Workflow Demo

CALL-E AI is a small, strictly offline demonstration of a phone-call agent workflow. It shows how an operator can provide an E.164 phone number, describe a call purpose, confirm permission, and preview a simulated conversation.

This is a local reference demo, not a production calling service. It does not connect to a telephone network, place real calls, use an AI model, or require API credentials.

## Requirements

- Python 3.9 or newer
- No external Python packages
- No API keys or paid services

## Run locally

Open a terminal in this directory and run:

```bash
python3 demo.py
```

Use only a fictional or standards-reserved example number. The demo requires an explicit purpose and confirmation that the destination is authorized, then masks the number in its output.

## Workflow boundary

- The demo is fake-only and performs no network requests or real-world side effects.
- Each invocation previews exactly one simulated call; it creates no jobs, retries, or recurring schedules.
- Closing the process cancels the local preview. There is no provider-side call to cancel or roll back.
- No credentials are read, stored, logged, or transmitted.
- The simulated result is illustrative only and must not be used for medical, legal, financial, emergency, or other high-stakes decisions.

## Safe validation

Run the demo with a reserved fictional number such as `+12025550123`, enter a purpose, and answer `yes` to the permission prompt. Verify that the output says no real call was placed and shows only the masked destination.

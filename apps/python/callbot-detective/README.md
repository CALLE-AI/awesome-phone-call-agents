# CallBot Detective

CallBot Detective turns a natural-language investigation mission into a real phone call, captures conversation evidence, and returns a structured result.

## Setup

```bash
python -m venv .venv
# activate the environment, then:
pip install -r requirements.txt
```

Set `CALLE_API_KEY` in your environment. Never commit API keys or real recipient data.

## Dry run

Preview the CALL-E task without placing a call:

```bash
python app.py --phone +15550101234 --mission "Ask whether the business is open today" --dry-run
```

## Real call

Review the target and task first, then explicitly opt in:

```bash
python app.py --phone +15550101234 --mission "Ask whether the business is open today" --execute
```

Starting with `--execute` has an external side effect: CALL-E may place an outbound phone call. Only call numbers you are authorized to contact.

## How it works

`Mission → Question Planning → CALL-E Call → Conversation → Structured Result`

The task is sent to CALL-E with a documented structured result schema. The returned call ID can be used to retrieve the final call outcome. If CALL-E cannot verify an answer, the application preserves that uncertainty instead of inventing a result.

## Safety

- Keep `CALLE_API_KEY` in environment variables or a secret manager.
- Use only authorized phone numbers.
- Review the generated task before execution.
- Treat transcripts and structured results as potentially sensitive.
- This example does not provide emergency decision-making or impersonation functionality.

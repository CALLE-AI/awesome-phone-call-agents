---
name: language-bridge-call
description: Cross-language relay call skill for CALL-E - places one call in the recipient's language to capture a structured answer, then one call back to the requester in their language, and returns an agreed outcome or a fail-closed handoff.
license: MIT
---

# Language Bridge Call

Use this skill when a requester (a property manager, workshop owner, coordinator) needs to coordinate a concrete, non-urgent task with someone who does not speak the requester's language well enough for a phone conversation. The skill places **at most two** disclosed CALL-E calls: first to the recipient in the recipient's language to deliver the request and capture a structured answer, then (only if that answer is readable) to the requester in the requester's language to relay the answer and pin an agreed outcome.

The value is the pair of calls, not a translation document: many recipients answer the phone but not email, forms, or text in a second language. The result is fail-closed structured JSON, not an agreement made on the agent's own judgment.

This skill does not interpret live conversations, certify anything, or commit either party to contracts, payments, or medical, legal, or financial terms.

## When To Use

- Ask for a maintenance access window from a tenant in their language, and report their answer back
- Confirm a schedule change with a seasonal worker or contractor who prefers another language
- Relay one bounded request (an object to bring, a document to have ready, a time to arrive) and capture a yes/no or a counter-proposal
- Produce an evidence-backed, two-sided disposition for a coordinator who would otherwise make phone calls through a friend or a dictionary

## When Not To Use

- Medical, legal, financial, emergency, insurance-claim, or government-interaction interpretation
- Anything that needs live back-and-forth between both humans on one line (use a human interpreter)
- Collecting payment details, ID numbers, signatures, or health information
- Calling a number the user did not provide and authorize in the request
- Hidden retries, recurring reminders, surveys, marketing, or political outreach
- Any request where consent from either party is missing or the request is urgent

## Required Inputs

- `request_id`: stable local identifier
- `topic`: short noun phrase for the call (for example "maintenance access")
- `message_to_recipient`: what the requester wants conveyed, in plain requester-language sentences
- `requester`: `display_name`, `role`, `first_name`, `phone` (E.164, authorized), `language`, `region`
- `recipient`: `first_name`, `phone` (E.164, authorized), `language`, `region`
- `timezone`: IANA
- `consent`: must be true
- `authorized_reason`: why these two specific numbers may be called for this request

Optional: `proposed_windows` (max 4 ISO-8601 times with offset the requester can actually honor).

## Preflight

1. Confirm the user authorized this one relay (both numbers) for this request.
2. Confirm both phones are E.164 and came from the requester's own records.
3. Refuse if `do_not_call` is true or `consent` is not true.
4. Run the dry-run preview and review both goal scripts before any CALL-E plan.

## Dry-Run Preview

From the repository root (no CALL-E credentials, no network):

```bash
python3 skills/language-bridge-call/scripts/relay_call.py --request skills/language-bridge-call/assets/sample-relay-request.json
```

Preview validates the request, prints masked phone numbers, both goal scripts, and the exact live command lines. It does not dial.

Fixture mode runs the complete two-call relay state machine against canned CLI envelopes (still no network, no `calle` install needed):

```bash
python3 skills/language-bridge-call/scripts/relay_call.py --request skills/language-bridge-call/assets/sample-relay-request.json --fixture skills/language-bridge-call/scripts/fixtures/relay_happy_path.json
python3 skills/language-bridge-call/scripts/test_relay_call.py
```

## CALL-E Goal Templates

Recipient call, rendered and spoken in `recipient.language`:

```text
You are an AI phone assistant working for {requester_display_name}, a {requester_role}.
Disclose immediately that you are an AI assistant and that this is one coordination call about {topic}.
Speak {recipient_language} throughout. If the person who answers is not {recipient_first_name}, apologize and end the call.

Purpose: relay this request and capture an answer.
Message: {message_to_recipient}
Offer only these windows, one at a time: {proposed_windows}.

Ask {recipient_first_name} to choose a window, propose a different time, or decline.
Do not discuss payments, contracts, deposits, or legal matters. Do not promise anything.
Close politely once you have captured the answer.

Before closing, record the answer as JSON with exactly these fields: understood (boolean),
consent_given (boolean), wrong_person (boolean), confidence (number between 0 and 1),
choice (one of the offered windows, or an empty string), counter_window (ISO-8601 time with
UTC offset, or an empty string), notes (one short sentence quoting the person, in their language).
```

Requester call, rendered and spoken in `requester.language`, includes the recipient's captured answer verbatim:

```text
You are an AI phone assistant calling {requester_first_name} back about {topic}.
Disclose immediately that you are an AI assistant.
Speak {requester_language} throughout.

Relay the recipient's answer exactly: {recipient_answer_summary}
If they chose a window, read it back and ask the requester to accept it.
If they proposed a different time or declined, relay that without negotiation.
Capture accept, decline, or next instruction. Do not commit to anything beyond relaying.

Record the outcome as JSON with exactly these fields: accepted (boolean),
agreed_window (one of the offered windows, or an empty string), notes (one short sentence).
```

## Structured Result

```json
{
  "request_id": "relay-2026-09-08-unit-12",
  "relay": "agreed | needs_human",
  "agreed_window": "ISO-8601 or null",
  "calls_placed": "0, 1, or 2",
  "recipient_call": {
    "disposition": "completed | voicemail | no_answer | wrong_number | no_consent | low_confidence | schema_drift",
    "answer": {"understood": true, "consent_given": true, "wrong_person": false, "confidence": 0.92, "choice": "ISO or empty", "counter_window": "ISO or empty", "notes": "one sentence in recipient language"}
  },
  "requester_call": {"disposition": "completed | skipped | ...", "answer": {"accepted": true, "agreed_window": "ISO or empty", "notes": "..."}},
  "needs_human_reason": "string or null"
}
```

Fail closed: voicemail, no-answer, wrong person, missing consent, low-confidence answers, and schema drift all become `needs_human` with the reason filled in. The recipient answer is bound to a typed contract before the requester call is planned: `understood`, `consent_given`, `wrong_person` must be booleans and `confidence` a number in [0, 1] — a missing or mistyped field is schema drift, a missing or non-true `consent_given` refuses the second call, and `confidence` below 0.7 routes to a human. The requester answer is type-checked the same way (`accepted` boolean, `agreed_window`/`notes` strings). An `agreed` result is a relayed confirmation, not a contract; the requester confirms any commitment themselves on the second call.

## Live Planning

Only after explicit user authorization and CALL-E authentication:

```bash
python3 skills/language-bridge-call/scripts/relay_call.py --request <authorized-request.json> --execute --confirm-consent
```

The script runs `calle call plan`, then `calle call run --plan-id --confirm-token`, then polls `calle call status --run-id` until a terminal status, for the recipient call first and the requester call second. If `run_call` has an uncertain outcome, the script stops and prints the exact `calle call recover --recovery-id <id>` command instead of retrying.

Planning without execution is always available and is not a call:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone America/Los_Angeles --language Spanish --region US
```

Do not run `--execute` unless the user separately confirms both numbers and the request text.

## Cancellation And Idempotency

Idempotency key: `language_bridge_call:{request_id}`, enforced by the script on `--execute`. Before any call is placed it records `status: started` in `~/.cache/language-bridge-call/<sha256 of request_id>.json` and marks it `done` with the final result afterwards; a re-run with the same `request_id` is refused (exit 2) with the prior status printed. If a run ends uncertainly, resolve it with the printed `calle call recover` command (or restart with a new `request_id`) rather than re-running; delete the state file only if you have verified no call was placed. Cancel before dial by not running `--execute`; there is no background job to cancel because the script does not schedule anything. Ambiguous outcomes route to a human rather than placing another call.

## Safety Notes

Read `references/safety.md` and `references/examples.md` before live planning.

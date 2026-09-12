---
name: relayme
description: Place one disclosed CALL-E phone call on behalf of a deaf, hard-of-hearing, or non-speaking user, hold the conversation, and return a text-first, fail-closed structured result. No human relay operator, no live typing. Mock (no-call) mode by default.
license: MIT
---

# RelayMe

A Deaf father wants to know if his daughter's prescription is ready before he
drives across town to a pharmacy with no website and no online refill. He cannot
make that call. His options today are to wait for a relay operator to join the
line, or to ask a hearing person for a favour. RelayMe is a third option: he
types the question, an AI assistant makes the call, and the whole conversation
comes back to him as a text thread with the answer at the bottom.

Use this skill when a deaf, hard-of-hearing, or non-speaking person needs one
everyday, voice-only task done: is a prescription ready, is an item in stock,
what are today's hours, a yes/no question to an office that only takes calls. The
user types the task. RelayMe places **one** disclosed CALL-E call, has the
conversation on their behalf, and returns it as a readable thread plus a
fail-closed structured result.

RelayMe is a text-first alternative to a telecommunications relay service (711
in the US), built for its known friction:

- **No human operator.** A relay operator hears every word of a medical or
  banking call. RelayMe has none; the conversation is between the AI and the
  business only.
- **No hang-ups.** Businesses routinely hang up on relay calls they do not
  recognise. The RelayMe agent speaks naturally in real time, so the callee has
  an ordinary conversation.
- **Not synchronous.** The user does not sit and type through the call. They
  state the task once and read the result when it is done.
- **An answer, not a transcript.** The result is structured and fail-closed, not
  raw speech to interpret.

## What the user sees

The call is delivered as a conversation thread (`apps/python/relayme/thread.py`),
rendered in a phone-style chat view (`apps/python/relayme/web/relayme.html`):

```
You      Is my prescription at Maple Street Pharmacy ready?
RelayMe  I'll call and say I'm an AI assistant calling for you. You'll see it all.
Agent    Is the prescription for Jordan Rivera ready for pickup?
Them     Yes, ready at the pickup counter, any time before 8 PM.
RelayMe  Here's your answer: it's ready, collect before 8 PM today.
```

The user's own spoken sensitive details (a phone number or email they asked to
be passed on) are redacted from the thread before display, since it may be shown
on a shared screen and the callee never consented to the call.

## When To Use

- A deaf, hard-of-hearing, or non-speaking user needs an answer that only a
  phone call can get, from a business the user names and authorizes.
- The question is a bounded information request: in stock, ready, open, price,
  yes/no, a time.
- The user wants the answer as text, asynchronously, without a human operator.

## When Not To Use

- Emergency, medical advice, legal, financial, collections, or political calls.
- First-contact sales, marketing, or any call the recipient did not expect a
  business to receive.
- Calling a number the user did not provide and authorize.
- Anything that commits the user to a purchase, appointment, or contract. RelayMe
  gathers an answer; it does not accept an offer or make a booking.
- Hidden retries or recurring calls. One authorized task is one call.

## Required Inputs

- `task_id`: stable local identifier for idempotency.
- `to_phone_e164`: destination number in E.164, provided and authorized by the user.
- `business_display_name`: the business the user is calling (for disclosure).
- `question`: the plain-language question the user wants answered.
- `caller_context`: how the agent should identify why it is calling, without
  revealing more about the user than needed (see `references/safety.md`).
- `consent`: must be `true`. The user authorized this one call.

Optional:

- `allowed_followups`: up to 3 clarifying questions the agent may ask if the
  first answer is incomplete. Nothing outside this list is asked.
- `language`, `region`, `timezone`: only when explicitly known.

## Preflight

1. Confirm the user authorized this one call to this one number.
2. Confirm `to_phone_e164` is valid E.164 and came from the user.
3. Refuse if `consent` is not `true` or the task falls under When Not To Use.
4. Run the dry-run preview before any CALL-E plan. Show the user the exact call
   goal and the question that will be asked, in text, and let them cancel.

## Dry-Run Preview

No CALL-E credentials, no network. From the repository root:

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock --thread
```

This reserves the task (reserve-before-dial), replays a fixture transcript, runs
it through the same classifier the live path uses, and prints the user-facing
text thread. It does not dial. Running the same `task_id` twice is refused rather
than dialling again.

Try the hard cases to see it fail closed (never a fabricated answer):

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --fixture apps/python/relayme/fixtures/hedged.json --thread
# also: voicemail.json, refused.json, wrong_number.json
```

Emit the thread for the web view and open it in a browser:

```
python3 apps/python/relayme/client.py --task skills/relayme/assets/sample-task.json --mock \
  --emit-thread-json /tmp/thread.json
# open apps/python/relayme/web/relayme.html (ships with embedded demo scenarios,
# or load /tmp/thread.json via the file picker)
```

## CALL-E Goal Template

```
You are an AI phone assistant calling on behalf of a person who cannot use the
phone directly. Disclose immediately and clearly that you are an AI assistant
making this call for someone, and that this is one short call.

You are calling {business_display_name}. Reason for the call: {caller_context}.

Ask this one question and listen carefully: "{question}"

If the answer is incomplete, you may ask only these follow-ups: {allowed_followups}.
Ask nothing else. Do not give medical, legal, or financial advice. Do not agree
to, book, buy, or cancel anything on the caller's behalf. Do not share personal
details about the caller beyond the reason for the call.

Capture the answer in the caller's own terms. If the person is unsure, record
that as unknown rather than guessing. If you reach voicemail, do not leave
sensitive details; record that it was voicemail. Thank them and end the call.
```

## How It Uses CALL-E

RelayMe drives CALL-E's three tools at runtime through the `calle` CLI:

1. `calle call plan --to-phone <E164> --goal "<goal>"` builds the call from the
   goal template above and returns a `plan_id` and `confirm_token`. RelayMe
   reserves the task before this step, so a duplicate is refused.
2. `calle call run --plan-id <id> --confirm-token <token>` places the call and
   returns a `run_id`.
3. `calle call status --run-id <id>` polls `get_call_run` until the call reaches
   a terminal state, then reads the transcript and structured result from
   `status_result.structuredContent`.

If `run_call`'s outcome is uncertain, RelayMe recovers with
`calle call recover --recovery-id <id>` rather than starting a new plan, so one
authorization is never dialled twice. The runnable client in
`apps/python/relayme/client.py` implements this flow, with a mock path that
exercises the same classifier and thread builder without placing a call.

## Structured Result

RelayMe returns a text-first, fail-closed result. The user reads `answer` and
`transcript_summary`; a machine can route on `outcome`.

```json
{
  "answer": "plain-language answer to the user's question, or empty if none",
  "outcome": "answered | partial | refused | voicemail | no_answer | wrong_number | needs_human",
  "transcript_summary": "short readable account of what was said, for the user",
  "follow_up_needed": true,
  "disclosed_ai": true
}
```

`answered` means the question was clearly answered. `partial`, `refused`,
`voicemail`, `no_answer`, `wrong_number`, and anything ambiguous route to
`needs_human`-style handling: RelayMe never reports an answer it did not hear,
and never treats silence or a machine as a yes.

## Cancellation And Idempotency

Idempotency key: `relayme:{task_id}`. Reserve it before dialling. If the user
cancels before the call is placed, do not dial. If a `run_call` outcome is
uncertain, use `calle call recover --recovery-id <id>` rather than starting a new
plan, so the same authorization is never dialled twice.

## Safety Notes

Read `references/safety.md` before live planning. Key boundaries: AI disclosure
is mandatory on every call, the agent gathers answers but never commits the user
to anything, and a call establishes what was said, not that it is true.

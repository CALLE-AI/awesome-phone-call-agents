---
name: cleared-to-call
description: Gate outbound CALL-E phone calls behind a declarative US federal compliance policy, so a collection or account-servicing call is placed only when the call window, consent, suppression, and disclosure checks all pass, is ended and suppressed the moment the recipient opts out, and leaves a tamper-evident audit record either way.
license: MIT
---

# Cleared to Call

Use this skill when an agent is about to place an outbound call to a consumer
about money: a past-due balance, a payment reminder, a collection follow-up, or
any account-servicing call where the recipient did not initiate the contact.

`cleared-to-call` is a gate, not a dialer. It does not replace the CALL-E call
workflow and it does not add a provider. It sits in front of one, decides
whether this call to this person at this moment is allowed, and refuses with a
named reason when it is not. Every decision, allow or refuse, is written to an
append-only audit log.

The rules are data, not prose. They live in `assets/policy.json` and are
explained in `references/policy.md`.

## When To Use

Use this skill for:

- outbound collection, payment-reminder, or past-due account calls
- any batch of consumer accounts where each row must be checked before dialing
- workflows that must honor "stop calling me" during the call, not after it
- workflows that must be able to prove afterwards that a call was lawful
- workflows that must be able to prove a call was correctly refused

## When Not To Use

Do not use this skill to:

- place calls outside the United States, or under any rule set other than US
  federal TCPA, FDCPA, and Regulation F - the policy is single-jurisdiction and
  a different region needs a different policy file, not a workaround
- decide anything for inbound calls the consumer initiated
- override, soften, or "just this once" bypass a block reason
- guess a missing timezone, consent record, or phone number
- give the recipient financial, legal, credit, or settlement advice
- negotiate, threaten, or discuss consequences of non-payment

If the caller wants a block overridden, the answer is to fix the underlying
record, not the gate. A missing timezone is fixed by getting the timezone, not
by assuming one.

## Required Inputs

Each account must carry all of these. None of them may be inferred:

- `account_id`
- `display_name`
- `phone_e164` - E.164, for example `+15550101234`
- `timezone` - IANA zone name, for example `America/New_York`
- `amount_due` and `currency`
- `consent_on_file` - true or false
- `consent_timestamp` - required when `consent_on_file` is true

Check a batch before evaluating any of it:

```bash
node scripts/validate-input.mjs --file accounts.json
```

A row that fails validation is reported and skipped. It is never dialed.

Never derive `timezone` from the phone number, the area code, the operator's
locale, the server clock, or the country code. Rule 1 is a statement about the
recipient's local time, so a guessed timezone is a guessed legal position. If
the timezone is missing or unknown, the account is blocked.

## Try It

The skill ships a fictional batch that hits every branch. Nothing dials:

```bash
node scripts/validate-input.mjs --file assets/example-accounts.json
node scripts/evaluate-account.mjs \
  --file assets/example-accounts.json --account-id A-1002 \
  --suppression assets/example-suppression.jsonl --now 2026-08-28T13:30:00Z
node scripts/check-revocation.mjs --utterance "stop calling me"
```

At that instant `A-1001` is clear, `A-1002` is outside its local call window,
`A-1003` has no consent, and `A-1004` is suppressed.

## The Pre-Dial Gate

Four rules run before anything dials. All four must pass.

| Rule | Requirement | Block reason |
| --- | --- | --- |
| R1 `call_window` | Local time at the recipient is inside 08:00-21:00 | `OUTSIDE_CALL_WINDOW` |
| R2 `consent_on_file` | Prior express consent is recorded, with a timestamp | `NO_CONSENT` |
| R3 `not_suppressed` | The number is not on the opt-out or DNC list | `ON_SUPPRESSION_LIST` |
| R4 `disclosure_ready` | The rendered script carries every required disclosure element | `MISSING_DISCLOSURE` |

Run the gate on one account:

```bash
node scripts/evaluate-account.mjs \
  --file accounts.json \
  --account-id A-1001 \
  --suppression suppression.jsonl
```

Exit code `0` is ALLOW, `2` is BLOCK, `1` is unusable input. The printed JSON
holds every rule result, not only the failing one, so an audit reader can see
the whole evaluation.

When several rules fail, the reported `block_reason` is the first failure in
policy order. All four are still evaluated and recorded.

Read `references/policy.md` for what each rule means, which authority it comes
from, and the property it is meant to enforce.

## The In-Call Revocation Handler

Rule 5 cannot be decided before dialing. It is enforced twice, and both halves
matter:

1. The call task tells the agent to stop the moment the recipient revokes:
   acknowledge once, end the call, do not ask why, do not offer alternatives.
2. After the call, the returned transcript is re-read for a revocation. That
   check is the one that writes the suppression entry.

The second step exists because the first cannot be trusted on its own. If the
agent talks past the opt-out, the number is still suppressed and the outcome is
still recorded as `opt_out`.

```bash
node scripts/check-revocation.mjs --utterance "stop calling me"
node scripts/check-revocation.mjs --transcript transcript.json
```

Exit code `3` means the number must be suppressed. Only recipient turns count:
the agent saying "if you would like us to stop calling" is a required
disclosure, not an opt-out.

Once suppressed, R3 blocks that number on every later run. The opt-out is
permanent unless the consumer asks for it to be reversed.

## How CALL-E Is Invoked

This skill does not place calls. Once an account is cleared, hand it to the
existing CALL-E route - the CALL-E CLI, MCP `plan_call` / `run_call` /
`get_call_run`, or whatever route the current client already uses:

```text
gate -> ALLOW -> plan_call -> inspect plan -> run_call -> get_call_run -> transcript -> revocation re-check
```

Requirements on the call task handed to CALL-E:

- the opening disclosure must be included verbatim and must be spoken first
- the task must instruct the agent to end the call on any revocation
- the task must restrict the agent to payment logistics
- the task must ask for one outcome from `promise_to_pay`, `dispute`,
  `refusal`, `no_answer`, `opt_out`
- the destination must be exactly the cleared account's number

Inspect the plan before running it. If the plan targets a different number than
the cleared account, do not run it. Providers often echo the destination masked,
for example `...9724`: compare its last four digits with the cleared number. A
plan that names no destination at all cannot be checked, and an unchecked plan
is not a verified one - do not run it unless the operator explicitly accepts
that. Match symbol masks only; the call script itself says "account ending
1001", and reading that as a destination would refuse every call.

## Structured Result

Every account yields exactly one result, whether or not it was called:

```json
{
  "account_id": "A-1001",
  "call_placed": true,
  "block_reason": null,
  "disclosure_given": true,
  "outcome": "promise_to_pay",
  "promise_date": "2026-09-05",
  "opt_out": false,
  "audit_ref": "aud_0af29e7f"
}
```

`outcome` is one of `promise_to_pay`, `dispute`, `refusal`, `no_answer`,
`opt_out`, `not_called`. A blocked account is always `not_called` with
`call_placed: false` and a non-null `block_reason`.

`disclosure_given` is read back from what the agent actually said, not from the
fact that the script contained it.

## Audit Record

Every decision appends one line to a JSONL log. Each line carries the hash of
the line before it, so an edited, deleted, or reordered entry breaks the chain
from that point on.

Each entry holds the timestamp, the account id, the masked phone number, the
decision, the block reason, every rule result, the outcome, the policy id and
version, and `prev_hash` plus `hash`.

Phone numbers in the audit log are always masked, for example `+1******1234`.

## Dry Run

Dry run is the default. In dry run the gate, the disclosure check, the
revocation detection, the suppression writes, and the audit chain all run
exactly as they do live - only the dialing is simulated.

Never place a real call to test the gate. A blocked account is proven blocked
without dialing, and a cleared account is proven cleared without dialing.

Place a real call only when the operator has explicitly asked for one, on a
number they are authorized to call.

## Safety Rules

Read `references/safety.md` for the full contract. Always:

- treat a phone call as a real-world side effect with legal consequences
- refuse rather than guess when a required field is missing or ambiguous
- mask phone numbers in every summary, log, and user-facing message
- never expose API keys, tokens, callback URLs, or confirmation tokens
- keep the call to payment logistics only, never advice or pressure
- honor an opt-out immediately and permanently
- never place a call for an account the gate blocked
- never edit or rewrite an audit entry

## Output Format

After a batch, report:

- how many accounts were cleared, blocked, and opted out
- each blocked account with its block reason
- each cleared account with its outcome and masked number
- any opt-out, with the number now suppressed
- the audit chain verification result and the number of entries

If the gate blocked everything, say so plainly and give the reasons. A run that
places no calls because no account was clearable is a successful run, not a
failure.

See `references/examples.md` for worked batches, including the refusal cases.

# Examples

Every number below is a reserved fictional `555-01xx` number and belongs to
nobody. All runs shown are dry runs.

## A batch, gated

Input batch:

```json
{
  "accounts": [
    {
      "account_id": "A-1001",
      "display_name": "J. Doe",
      "phone_e164": "+15550101234",
      "timezone": "America/New_York",
      "amount_due": 220.0,
      "currency": "USD",
      "consent_on_file": true,
      "consent_timestamp": "2026-01-15T10:00:00Z"
    },
    {
      "account_id": "A-1002",
      "display_name": "R. Alvarez",
      "phone_e164": "+15550101235",
      "timezone": "America/Los_Angeles",
      "amount_due": 87.5,
      "currency": "USD",
      "consent_on_file": true,
      "consent_timestamp": "2026-02-02T17:30:00Z"
    },
    {
      "account_id": "A-1003",
      "display_name": "M. Chen",
      "phone_e164": "+15550101236",
      "timezone": "America/Chicago",
      "amount_due": 415.0,
      "currency": "USD",
      "consent_on_file": false,
      "consent_timestamp": null
    }
  ]
}
```

Evaluated at `2026-08-28T13:30:00Z`, with `+15550101237` already on the
suppression list:

```text
ACCOUNT   DECISION REASON / OUTCOME       DISCLOSED  AUDIT
A-1001    ALLOW    promise_to_pay         yes        aud_188921a1
A-1002    BLOCK    OUTSIDE_CALL_WINDOW    -          aud_78d57285
A-1003    BLOCK    NO_CONSENT             -          aud_27087e66
A-1004    BLOCK    ON_SUPPRESSION_LIST    -          aud_68e9f7a9
```

`A-1001` and `A-1002` differ only in timezone. At 13:30 UTC it is 09:30 in New
York and 06:30 in Los Angeles, so one is inside the window and the other is not.
Same batch, same instant, different answer - which is the point of reading the
timezone from the record instead of from the number.

## Blocked - outside the call window

```bash
node scripts/evaluate-account.mjs \
  --file accounts.json --account-id A-1002 --now 2026-08-28T13:30:00Z
```

```json
{
  "account_id": "A-1002",
  "phone_masked": "+1******1235",
  "decision": "block",
  "block_reason": "OUTSIDE_CALL_WINDOW",
  "rules": [
    {
      "rule_id": "R1",
      "name": "call_window",
      "passed": false,
      "detail": "local time 2026-08-28 06:30 (America/Los_Angeles) is outside 08:00-21:00"
    },
    { "rule_id": "R2", "name": "consent_on_file", "passed": true, "detail": "consent recorded 2026-02-02T17:30:00Z" },
    { "rule_id": "R3", "name": "not_suppressed", "passed": true, "detail": "+1******1235 is not on the suppression list" },
    { "rule_id": "R4", "name": "disclosure_ready", "passed": true, "detail": "script contains: caller_identity, automated_voice_identity, debt_collection_purpose, opt_out_instruction" }
  ],
  "rules_evaluated": { "R1": "fail", "R2": "pass", "R3": "pass", "R4": "pass" }
}
```

Exit code `2`. Every rule is reported, not only the failing one.

Correct response to the operator:

```text
A-1002 was not called: 06:30 local time in America/Los_Angeles is outside the
08:00-21:00 window. It becomes callable at 08:00 local, which is 15:00 UTC today.
```

Do not offer to call anyway. Do not offer to use a different timezone.

## Blocked - no consent

```json
{
  "account_id": "A-1003",
  "decision": "block",
  "block_reason": "NO_CONSENT",
  "rules_evaluated": { "R1": "pass", "R2": "fail", "R3": "pass", "R4": "pass" }
}
```

A consent flag set to true with no `consent_timestamp` fails the same way:

```text
A-1003 was not called: no prior express consent is recorded for this account.
This needs a consent record with a timestamp before the account can be dialed.
```

## Blocked - on the suppression list

```text
A-1004 was not called: +1******1237 is on the opt-out list, added 2026-06-11.
This block is permanent unless the consumer asks for it to be reversed.
```

This is the block that must never be worked around. A number arrives on that
list because a person asked to be left alone.

## Blocked - missing disclosure

The script, not the account, fails this one:

```bash
node scripts/evaluate-account.mjs \
  --file accounts.json --account-id A-1001 --script "Pay us today."
```

```json
{
  "decision": "block",
  "block_reason": "MISSING_DISCLOSURE",
  "rules": [
    {
      "rule_id": "R4",
      "name": "disclosure_ready",
      "passed": false,
      "detail": "script is missing: caller_identity, automated_voice_identity, debt_collection_purpose, opt_out_instruction"
    }
  ]
}
```

The fix is to add the disclosure to the script, never to relax the rule.

## Cleared - the call opens with the disclosure

```text
Hello, this is an automated assistant calling on behalf of Northbridge Lending
about your account ending 1001. This is an attempt to collect a debt, and any
information obtained will be used for that purpose. If you would like us to stop
calling, say stop calling and I will end this call and remove your number.
```

Then, and only then, the payment question. The disclosure is spoken first and in
full.

Result:

```json
{
  "account_id": "A-1001",
  "call_placed": true,
  "block_reason": null,
  "disclosure_given": true,
  "outcome": "promise_to_pay",
  "promise_date": "2026-09-05",
  "opt_out": false,
  "audit_ref": "aud_188921a1"
}
```

## Cleared, then opted out mid-call

Transcript:

```json
[
  { "speaker": "agent", "text": "Hello, this is an automated assistant calling on behalf of Northbridge Lending about your account ending 1005. This is an attempt to collect a debt, and any information obtained will be used for that purpose. If you would like us to stop calling, say stop calling and I will end this call and remove your number." },
  { "speaker": "recipient", "text": "Who is this?" },
  { "speaker": "agent", "text": "An automated assistant calling about your past-due account." },
  { "speaker": "recipient", "text": "Stop calling me. I do not want these calls." },
  { "speaker": "agent", "text": "Understood. I will remove your number and you will not receive further calls from us. Goodbye." }
]
```

```bash
node scripts/check-revocation.mjs --transcript transcript.json
```

```json
{
  "revoked": true,
  "turn_index": 3,
  "speaker": "recipient",
  "text": "Stop calling me. I do not want these calls.",
  "matched_phrase": "stop calling",
  "action": "end_call_and_suppress"
}
```

Exit code `3`. Result:

```json
{
  "account_id": "A-1005",
  "call_placed": true,
  "block_reason": null,
  "disclosure_given": true,
  "outcome": "opt_out",
  "promise_date": null,
  "opt_out": true,
  "audit_ref": "aud_faf58034"
}
```

The agent's first turn contains the phrase "stop calling" as part of the
required disclosure, and turn 0 is not flagged - only recipient turns are read.

Run the same batch again and that account is now blocked:

```text
A-1005    BLOCK    ON_SUPPRESSION_LIST    -    aud_9c4471be
```

The opt-out becoming a permanent block, on the next run, with no further human
action, is the whole point of writing it to the suppression list rather than
just to the result.

## An agent that ignores the opt-out

The recipient revokes and the agent keeps going:

```json
[
  { "speaker": "agent", "text": "Hello, this is an automated assistant calling on behalf of ..." },
  { "speaker": "recipient", "text": "Take me off your list." },
  { "speaker": "agent", "text": "Could you pay half today instead?" },
  { "speaker": "recipient", "text": "Fine, the thirtieth." }
]
```

The agent would report `promise_to_pay`. The post-call check overrides it:

```json
{
  "outcome": "opt_out",
  "promise_date": null,
  "opt_out": true
}
```

The promise is discarded, the number is suppressed, and the audit entry records
`opt_out`. A promise extracted after an opt-out is not a promise worth keeping.

## An unusable row

```bash
node scripts/validate-input.mjs --account-json '{"account_id":"A-9999","display_name":"X","phone_e164":"5550101234","timezone":"EST","amount_due":10,"currency":"USD","consent_on_file":"yes"}'
```

```json
{
  "rows": 1,
  "usable": 0,
  "unusable": 1,
  "report": [
    {
      "index": 0,
      "account_id": "A-9999",
      "phone_masked": "55****1234",
      "usable": false,
      "problems": [
        "phone_e164 is not E.164: 55****1234",
        "timezone is not an IANA zone name: EST",
        "consent_on_file must be true or false"
      ]
    }
  ]
}
```

Exit code `2`. The row is reported and skipped. Note that even the rejected
number is masked in the error message.

`EST` is rejected because it is a fixed offset, not a zone: it cannot answer
what time it is at the recipient in July.

## Reporting a batch

```text
7 accounts: 4 cleared, 3 blocked, 1 opt-out.

Blocked:
  A-1002  OUTSIDE_CALL_WINDOW   06:30 local (America/Los_Angeles)
  A-1003  NO_CONSENT            no consent record on file
  A-1004  ON_SUPPRESSION_LIST   +1******1237, opted out 2026-06-11

Called:
  A-1001  +1******1234  promise_to_pay  2026-09-05
  A-1005  +1******1238  opt_out         number now suppressed
  A-1006  +1******1239  no_answer
  A-1007  +1******1240  dispute         recorded, not contested

Audit chain: verified, 7 entries.
```

Report the blocks first. They are the part someone has to act on.

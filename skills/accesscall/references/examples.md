# AccessCall Examples

[#accesscall-examples](#accesscall-examples)

Setup, validation, and behavior scenarios for the `accesscall` skill, based on real end-to-end test calls.

## Setup Verification

[#setup-verification](#setup-verification)

Before placing any call, verify the CLI and auth are working. This must never place a call:

```
calle auth status
calle mcp tools
```

Confirm `plan_call`, `run_call`, and `get_call_run` are listed. Do not proceed to `plan_call` until this succeeds.

## Scenario 1: Clean intake call

[#scenario-1-clean-intake-call](#scenario-1-clean-intake-call)

A caller reports a barrier, answers all intake questions clearly, and consents to email follow-up.

Recap the bot produces at end of call:

```
Assistive technology: screen_reader
Task attempted: submitting a benefits enrollment form
Barrier category: operable
Severity: blocked_entirely
Consent to follow-up: yes
```

Parsed result validates cleanly against `references/intake-result.schema.json`. If a VPAT insertion is run, it lands on an Operable (2.x) criterion row with Conformance Level `Does Not Support` (derived from `blocked_entirely`, not from the barrier category, see `references/safety.md`).

## Scenario 2: Transcription error caught by contact confirmation

[#scenario-2-transcription-error-caught](#scenario-2-transcription-error-caught)

Real test call transcript excerpt:

```
Bot: Please spell the email address letter by letter, including the domain.
Caller: J-E-R-L-Y-N at D-E-S-I-G-N-L-A-D-Y dot com
Bot: I heard an email starting with J-E-R-L-Y-N at A-T-D-E-S-I-G-N-L-A-D-Y dot com. Is that right?
```

The speech-to-text layer inserted a duplicate "at" into the domain. The bot's letter-by-letter read-back surfaced this for the caller to catch before the call ended, this is the confirmation mechanism working as designed.

**Known limitation, not a fix:** in one live test, the caller confirmed "correct" to a garbled domain without catching the error themselves. The mechanism prevents the bot from silently guessing wrong and moving on; it does not guarantee the human catches every error in a fast phone exchange. Document this to end users rather than presenting the mechanism as fully reliable.

## Scenario 3: Ambiguous or unclear barrier category

[#scenario-3-unclear-barrier-category](#scenario-3-unclear-barrier-category)

If the caller's answer to the barrier-type question does not clearly map to Perceivable, Operable, Understandable, or Robust, record `barrier_category: "unclear"`. When inserting into a VPAT template, do not guess a matching row, append a new row flagged `FLAG FOR MANUAL REVIEW` instead.

## Scenario 4: Unconfirmed follow-up contact

[#scenario-4-unconfirmed-contact](#scenario-4-unconfirmed-contact)

If the call ends before the letter-by-letter confirmation completes (dropped call, caller hangs up mid-spelling), record `followup_contact_confirmed: false` and omit `followup_contact` from any VPAT insertion. Note "Contact unconfirmed, verify manually" in the Remarks column instead of writing a possibly-wrong contact detail into an audit deliverable.

## Failure Scenario: No schema-input parameter

[#failure-scenario-no-schema-input](#failure-scenario-no-schema-input)

This MCP server's `plan_call` tool was checked directly against its `inputSchema` and has no `resultSchema`, `result_schema`, `extraction_schema`, or equivalent parameter. Do not add one to a `plan_call` invocation, the server will either reject or silently ignore it, and documenting it as a real capability would be inaccurate. Structured extraction is handled entirely by having the bot recap its answers in a fixed format during the call, then parsing that recap from the transcript.

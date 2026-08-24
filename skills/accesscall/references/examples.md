# AccessCall Examples

[#accesscall-examples](#accesscall-examples)

Setup, validation, and behavior scenarios for the `accesscall` skill.

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

[#scenario-2-contact-confirmation](#scenario-2-contact-confirmation)

This synthetic scenario demonstrates the required confirmation flow. The intended follow-up address is `contact@example.com`.

Example exchange:

> **Bot:** Please spell your email address one character at a time.
>
> **Caller:** c-o-n-t-a-c-t at e-x-a-m-p-l-e dot c-o-m.
>
> **Bot:** I heard c-o-n-t-a-c-t-t at e-x-a-m-p-l-e dot c-o-m. Is that correct?
>
> **Caller:** No. It is c-o-n-t-a-c-t at e-x-a-m-p-l-e dot c-o-m.
>
> **Bot:** I heard c-o-n-t-a-c-t at e-x-a-m-p-l-e dot c-o-m. Is that correct?
>
> **Caller:** Yes, that is correct.

Set `followup_contact_confirmed: true` only after the caller explicitly confirms the final spell-back. Until then, keep it `false` and do not include the contact in a VPAT insertion.

Letter-by-letter spell-back reduces transcription risk, but it does not guarantee that every address is captured correctly.

## Scenario 3: Ambiguous or unclear barrier category

[#scenario-3-unclear-barrier-category](#scenario-3-unclear-barrier-category)

If the caller's answer to the barrier-type question does not clearly map to Perceivable, Operable, Understandable, or Robust, record `barrier_category: "unclear"`. When inserting into a VPAT template, do not guess a matching row, append a new row flagged `FLAG FOR MANUAL REVIEW` instead.

## Scenario 4: Unconfirmed follow-up contact

[#scenario-4-unconfirmed-contact](#scenario-4-unconfirmed-contact)

If the call ends before the letter-by-letter confirmation completes (dropped call, caller hangs up mid-spelling), record `followup_contact_confirmed: false` and omit `followup_contact` from any VPAT insertion. Note "Contact unconfirmed, verify manually" in the Remarks column instead of writing a possibly-wrong contact detail into an audit deliverable.

## Failure Scenario: No schema-input parameter

[#failure-scenario-no-schema-input](#failure-scenario-no-schema-input)

This MCP server's `plan_call` tool was checked directly against its `inputSchema` and has no `resultSchema`, `result_schema`, `extraction_schema`, or equivalent parameter. Do not add one to a `plan_call` invocation, the server will either reject or silently ignore it, and documenting it as a real capability would be inaccurate. Structured extraction is handled entirely by having the bot recap its answers in a fixed format during the call, then parsing that recap from the transcript.

# CALL-E feedback template

Submit feedback only after controlled AU or SG calls. Include call IDs that the
CALL-E team can inspect, but never publish phone numbers, transcripts containing
personal data, or API credentials.

## Test context

- SDK: `@call-e/calle@0.2.2`
- Region / locale:
- Controlled recipient and consent method:
- Task shape: one recipient, strict seven-field object schema
- Call ID:

## Locale behavior

- Did the disclosed introduction sound natural in `en-AU` or `en-SG`?
- Were times such as "06:30" read and understood in local convention?
- Were local names, place names, and concrete terms pronounced clearly?
- Did the assistant remain concise under interruption?

## Structured-result reliability

- Did all required fields return?
- Were additional properties rejected?
- Did voicemail, wrong contact, uncertainty, and conditional answers map
  conservatively?
- Did any structured value contradict the transcript or evidence?

## Lifecycle and developer ergonomics

- Which statuses were observed, and did their transitions match polling?
- How quickly did structured result, completion judgment, confidence, evidence,
  and transcript turns become available?
- Was a failed or partial dispatch easy to diagnose without exposing provider
  internals?
- Did reusing an idempotency key reliably return the original call?

## Evidence handling

- Was evidence specific enough to explain the result?
- Were transcript offsets and speaker labels usable?
- What redaction or evidence-linking support would reduce application code?

## Suggested improvement

Describe one reproducible issue, its impact, the expected behavior, and the
smallest API or documentation change that would resolve it.

# Safety Reference — landmark-navigation-assist

This skill places one real outbound phone call per invocation. This document
covers the safety boundaries around that call.

## Explicit user intent

- The call must be triggered by an explicit action — a driver (or the app on
  their behalf) requesting navigation help for a specific delivery. This
  skill does not implement, and must not be wired up to, any proactive or
  scheduled outbound call to a recipient who did not ask for one.
- There is no inbound "driver calls in" flow. The skill only builds an
  outbound `task` string; it assumes a "request help" action already
  happened upstream (e.g. a button in a delivery app).

## Phone numbers

- All recipient and contact phone numbers must be E.164 format
  (`+<countrycode><number>`).
- Every phone number in this skill's own examples, sample config, and
  documentation is a standards-reserved fictional number
  (`+14155550199`, from the NANP 555-01xx reserved block). Never replace
  these with a real number in anything you commit or share publicly —
  real numbers belong only in a private, uncommitted deployment config.
- The escalation contact's number is read aloud to the driver inside the
  call itself. It is not otherwise transmitted, logged to a third party, or
  exposed in the structured result — `resultSchema` only returns booleans
  (`escalation_offered`, `escalation_number_revealed`) and a text summary,
  never the number itself.

## No hidden or duplicate actions

- The generated `task` never asks CALL-E to place a second call, hit a
  webhook, or send an SMS. Escalation resolves entirely within the single
  call: if the driver confirms they want a contact number, the agent reads
  it aloud and the call ends. The driver dials the number themselves,
  outside of CALL-E's involvement.
- This skill has no polling loop, retry scheduler, or queue of its own. One
  invocation places exactly one call. There is no mechanism by which the
  same delivery could trigger two calls unless the caller's own integration
  explicitly invokes it twice.

## No credential exposure

- This skill's own code (`scripts/buildCallTask.js`,
  `scripts/locationConfigSchema.js`) never reads or requires a CALL-E API
  key. Credential handling is entirely the integrating application's
  responsibility — see your CALL-E SDK setup for how to keep the API key
  server-side only.

## Cancellation / rollback behavior

Not applicable in the recurring-workflow sense — this is a single, one-shot
outbound call, not a scheduled or recurring job. There is nothing queued to
cancel after the call is placed. The only "undo" surface is escalation
itself, and escalation never takes an automated action that would need
undoing (see above).

## Boundaries

- This skill is scoped to physical-location wayfinding only. It must not be
  used to carry medical, legal, financial, or emergency content — the
  escalation path is a plain callback number, not a warm transfer, and is
  not a substitute for an actual emergency line.
- If the driver's situation clearly falls outside wayfinding (e.g. a safety
  emergency), the generated task does not attempt to handle it; that is out
  of scope for this skill by design.

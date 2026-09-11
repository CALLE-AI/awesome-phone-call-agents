# Safety rules

These are the rules the reference implementation enforces in code, not
aspirations. Where a rule is enforced by a specific mechanism, the mechanism
is named.

## Explicit user intent

- Calls are placed only to customers who already hold a booking in the
  operator's own calendar file. There is no discovery, enrichment, or list
  building of any kind.
- A run is always operator-initiated for one named date. There is no
  scheduler, daemon, or cron path in the skill.
- `preview` places no calls and is the documented first step of every run.

## Phone numbers

- Every destination is validated as E.164 before a call is attempted;
  malformed numbers are skipped and reported, never "fixed" by guessing a
  country code.
- Demo and test data use only ACMA-reserved fictional Australian numbers
  (the `+61 491 570 xxx` range), which are allocated for exactly this purpose
  and reach no one.
- A live demonstration must pass `--override-phone`, which routes **every**
  call in the run to one number the operator supplies at the command line.
  This exists so a demo can never dial a third party by accident.

## Masking in summaries

- The operator summary prints names, times, services, and outcomes. It does
  not print customer phone numbers.
- When recording or sharing a terminal session, the `--override-phone`
  argument echoes the operator's own number into the scrollback and window
  title; redact it before publishing. (This was learned the hard way.)

## Credentials

- `CALLE_API_KEY` is read from the environment only. It is never written to
  the calendar file, the call ledger, the summary, or any log line.
- The repository ships a `.gitignore` covering `.env` and all run artefacts.

## No hidden recurrence, no duplicate jobs

- One invocation calls each pending booking at most once. Completed outcomes
  are written back immediately, so a re-run of the same date calls only what
  is still pending or previously unanswered.
- There is no retry loop, no background queue, and no state that survives
  outside the visible calendar and ledger files.
- A file-backed **call budget** caps the number of real calls that can ever
  be placed, and has no override flag: exceeding it raises and stops the run.
  Raising the cap is a deliberate edit to the configuration, recorded in
  version control.

## Cancellation

- A run is a foreground process; interrupting it stops further calls.
  Outcomes already returned are already written, so state is never
  half-applied in a way that hides what happened.
- Any booking the agent could not resolve is surfaced in `Needs you:` rather
  than retried silently.

## Content boundaries

- The agent states the service name and the appointment time. It does not
  discuss medical, legal, or financial matters, and is not to be used for
  appointments where the subject of the call is itself sensitive.
- It never asks for payment details, identity documents, or any personal
  information. It only asks whether an existing time still suits.
- It does not argue, persuade, or attempt retention. A cancellation is
  accepted on the first statement of it.

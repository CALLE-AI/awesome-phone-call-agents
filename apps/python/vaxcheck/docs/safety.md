# VaxCheck safety rules

This app calls the parents and guardians of schoolchildren about a medical procedure.
Everything below is a constraint on that, not a guideline.

## Explicit user intent

- The default mode places no call and uses no network. Running the app does nothing to
  anyone.
- Real calls require **two** explicit flags: `--execute` and `--confirm-consent`.
  `--execute` alone refuses to run.
- `--preflight` makes real CALL-E API requests but cannot dial. It is safe to run
  against a full roster.
- The operator confirms they are authorised to call every guardian on the roster. The
  app cannot verify authorisation and does not try to.

## E.164 phone numbers

- Every number is validated as ASCII E.164 once, at roster load, with a full match
  after stripping spaces, hyphens, dots and parentheses. A malformed number fails the
  whole roster rather than being guessed at or silently skipped.
- Duplicate `student_id`s are rejected: duplicate ids produce duplicate idempotency
  keys, which would mean a second call to the same family.

## Masking phone numbers

- Numbers are masked (`+14*****0101`) in every preview, report, log line, and error.
  Free text returned by a call and provider error messages are redacted for anything
  that looks like a phone number before they are stored or shown. Requests are not.
- The call script sent to CALL-E never contains a raw number, and neither does the
  display goal used for previews and preflight.
- Two tests enforce this: one asserts no raw number appears anywhere in rendered output,
  one asserts none reaches the call script.

## No credential exposure

- `CALLE_API_KEY` is read from the environment and never logged, printed, or written to
  an output file. It is only ever sent to an approved HTTPS origin
  (`https://api.heycall-e.com`); `CALLE_BASE_URL` cannot point it anywhere else.
- `--preflight` shells out to the `calle` CLI with `shell=False` and a fixed argument
  vector. OAuth tokens stay in the CLI's own private cache and are never handled here.
- Output files contain masked numbers, dispositions, reasons, and guardian-reported
  detail. They contain no credentials.

## No hidden recurring schedules

- The app has no scheduler, no cron, no daemon, no retry loop. One invocation is one
  pass over one roster.
- Recurrence, if a school wants it, belongs to the host scheduler. This app places
  exactly one call per student per run.

## No duplicate jobs

- Idempotency keys are derived from school, session date, and student id. They contain
  no timestamp and no random component, so the same roster always produces the same
  keys.
- Within CALL-E's idempotency window, a retried create with the same key and request
  returns the same call rather than dialling again. The window is finite and provider-
  defined; the app does not persist call ids, so outside it, or with a changed request,
  a re-run creates a new call. `--resume <call_id> --student <id>` fetches an existing
  call without creating one and accepts it only if the call's metadata names that
  student and this session — never by phone number, never by falling back to another
  row.
- Calls run sequentially and a failure stops the run, so a fault cannot fan out into a
  burst of calls to families.

## Cancellation

- Interrupting the process stops the roster. Calls already placed are unaffected —
  CALL-E owns an in-flight call, and killing the client neither cancels nor fails it.
- To recover state afterwards, use `--resume <call_id>`. Never re-run `--execute`
  expecting it to cancel anything.

## Medical, legal, financial and emergency boundaries

This is the boundary the whole app is built around.

- **The app makes no medical determination.** It records what a guardian reported. It
  never decides whether a child is fit for a vaccine.
- **The agent gives no medical advice.** The call script forbids it explicitly. Any
  clinical question — side effects, interactions, whether an allergy matters — is
  answered with "I cannot advise; the school nurse or your own doctor will", and the
  question is recorded so a person follows up.
- **The agent must not diagnose, reassure, or minimise** any symptom or allergy a
  guardian describes.
- **Every clinical signal routes to a human.** Severe or unclear allergy history, a
  child who may be unwell, an unclear or reported prior dose — all force nurse review.
  None can be cleared automatically.
- **A decline is final.** The script forbids pressuring, persuading, or re-asking after
  a clear decision.
- **Identity is confirmed before any detail.** Nothing about a child is disclosed until
  the person on the line confirms they are that child's parent or legal guardian. If
  they are not, the call ends without discussing the student.
- **The agent identifies itself as automated** whenever asked.
- **Distress ends the questions.** If a guardian is distressed, asks for a person, or
  the call becomes unclear, the agent stops, says staff will call back, and ends warmly.
- **Not for emergencies.** This is scheduled administrative outreach. It must never be
  used for urgent clinical communication, and it has no escalation path.

## What a cleared row means

`cleared_for_school_session` means **nothing was flagged**. It is not medical clearance
and not a consent record of legal weight. A nurse confirms the final list before any
child is vaccinated, and every review row must be resolved by a person first. The
roster prints that sentence at the bottom of every run.

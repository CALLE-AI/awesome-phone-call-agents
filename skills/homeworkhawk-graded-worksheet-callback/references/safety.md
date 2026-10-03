# Safety and Curation Rules

This skill can place a real outbound phone call about a child's school
work. Every rule below is mandatory. The workflow fails closed: when a
rule cannot be checked, no call is placed.

## Explicit intent and approval

- The **default path is preview**: no call is placed unless the
  operator passes `--approve-call` for this specific worksheet.
- Approval is per call. There is no standing approval, no "auto-call
  next time", and no batch approval of a worksheet queue.
- The parent/guardian must have opted in to phone callbacks in the
  grading app. An opt-in given by the child, a teacher's assistant, or
  any third party is not consent.

## Destination number

- The dial target must be strict **E.164** (for example `+12025550100`)
  AND match the **authorized guardian contact** recorded in the app by
  the parent. An empty or missing allowlist fails closed.
- The number is never taken from the worksheet photo, the child's
  input, or a message thread. Only the parent's own app settings are
  trusted.

## Ambiguity gate (stop ambiguous calls)

Before `--approve-call` may dial, the grading result must pass:

1. `student_name` present and confidently read (or a clearly neutral
   salutation is used instead — never a guessed name).
2. Every question row has a `verdict` in {correct, incorrect,
   escalated}; rows missing a verdict fail the gate.
3. No more than **20% of questions are `escalated`**. Above that, the
   reading itself is too unreliable to summarize by phone and the
   result goes back to the app for human review.

A failed gate is logged as `blocked_ambiguous` with the reason and
**no call is placed**.

## Output masking

- Phone numbers are masked in every output: `+12025550100` becomes
  `+1•••••0100` in logs, transcripts, error messages, and the result
  JSON the app stores.
- The child's full name is spoken on the call only after the
  destination passes the allowlist check, and appears in stored
  transcripts only as the app already stores it; the skill never adds
  new copies of identifying data beyond the worksheet record.

## Credentials

- `CALLE_API_KEY` is read from the environment only. It is never
  logged, never embedded in prompts or transcripts, never committed,
  and never passed to the model as readable context beyond what the
  SDK requires.

## Schedules and duplicates

- No hidden or recurring schedules. A call happens only when an
  operator runs the workflow for one worksheet.
- **One call per worksheet, ever.** The worksheet id is the
  idempotency key; a second run for the same id returns the stored
  result instead of dialing again.
- A failed or unanswered call is **not** retried automatically. The
  app may surface "callback not delivered" to the parent in-app.

## Cancellation behavior and limits

- Stop **before submission** to avoid placing the call. Once submitted,
  stopping the local workflow (Ctrl-C) or timing out while waiting for
  `createAndWait` does not confirm provider cancellation. The submitted
  call may still connect or continue; this reference does not implement
  provider-side cancellation.
- Once the call is **live**: the operator cannot silently drop in —
  cancellation is in the parent's hands. The parent can hang up at any
  time; the agent ends politely and marks the call `ended_by_parent`.
- The skill never redials after a cancellation, a hang-up, or a
  no-answer. Total attempt limit: **one**.

## Content boundaries (hard limits)

- **Grading is advisory.** The script frames results as "here is what
  to look at together", never as an official grade, a ranking, or a
  judgment of the child. `escalated` questions are surfaced as
  "please check by hand", never as wrong answers.
- **No medical, lab-result, legal, financial, or emergency content**
  in any mode, supervised or not. This skill must not be repurposed to
  deliver health or diagnostic information; those communications
  require a licensed professional and are out of scope by design.
- The tone rule is absolute: warm, tutor-like, non-judgmental. If a
  parent asks the agent for a diagnosis, a legal opinion, financial
  advice, or emergency help, the agent says a person will follow up
  and ends the call.
- One topic only: the worksheet. The agent does not answer open-ended
  questions or stray into other subjects on the call.

# Safety checklist before adapting this pattern to a real workflow

Work through this before pointing `structured-outcome-followup-call` at any real phone number,
real recipient, or real downstream action. None of this is enforced by the code — it's a
checklist for the person adapting the skill, not a runtime guardrail, and that's worth being
explicit about.

## Consent

- The **calling application**, not this skill, is responsible for confirming the recipient has
  consented to be contacted for this purpose. This skill performs no consent verification —
  don't assume it does.
- Make sure whatever list of phone numbers feeds `CallTask.phone_number` has already been
  filtered to people who opted in to this specific kind of follow-up.

## Idempotency

- A real adapter's `initiate_call` should always send an idempotency key (see the note in
  SKILL.md about what a real adapter needs to add) so a retried request can't double-dial the
  same recipient. The mock provider doesn't need this since it never actually dials anyone, but
  don't drop it when you write a real adapter.

## Phone number formatting

- Use E.164 formatting (`+<country code><number>`, no spaces or punctuation) for every phone
  number passed into `CallTask.phone_number`. Malformed numbers are a common integration
  failure point — validate before calling, not after a failed call comes back.

## Credential boundaries

- No example in this skill embeds a real API key. If you write a real adapter, read credentials
  from environment variables only, and keep the mock provider as the default so this skill
  stays runnable with zero credentials for anyone evaluating or learning from it.

## Cancellation and duplicate-job prevention

- If your adopting application schedules calls ahead of time (e.g. "call in 2 hours"), make
  sure there's a way to cancel a scheduled call before it fires, and make sure a call that
  already completed can't be accidentally re-triggered by a retry or a duplicate scheduling
  job.

## Where NOT to let the follow-up action fire automatically

This is the most important line to get right, and it's the reason this skill's own example
keeps the follow-up action to a printed log line rather than a real integration:

- **Never let this pattern's automatic follow-up action be the sole path to a decision that
  needs professional judgment** — medical, legal, financial, or safety-critical decisions in
  particular. This pattern's reference implementation grew out of a healthcare use case, and
  the boundary that came out of that is worth stating explicitly for anyone reusing it:
  **this pattern must never be used to have the calling agent give medical, legal, or other
  professional advice, or to make a clinical/professional decision on its own.** It's built to
  gather structured self-reported data and route it to a human or a downstream system for
  review — not to replace that human's judgment.
- If you're adapting this for a domain where a "high score" outcome should trigger something
  consequential (paging someone, cancelling something, spending money), keep a human
  acknowledgment step in the loop before the consequential part happens, the same way this
  pattern's own escalation-acknowledgment step works in its originating application.

## Result-handling transparency

- Document, for anyone reading your adaptation, exactly what happens to the structured answers
  after the call: where they're stored, how long they're kept, who scores them, and what
  triggers as a result. Don't let this turn into an opaque pipeline — the entire value of a
  deterministic rubric (over an opaque model call) is that someone can read it and know exactly
  why a given call led to a given action.

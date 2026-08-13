---
name: call-summarizer
description: Turn a finished CALL-E phone-call transcript into a structured post-call brief with a one-line outcome, a masked summary, extracted action items with owners and due dates, caller sentiment, and a redacted caller fingerprint. Use after any CALL-E call when an agent or operator needs an actionable, reviewable record of what was said without re-reading the whole transcript or re-playing the recording.
license: MIT
---

# Call Summarizer

Use this skill after a CALL-E call has completed and the agent needs to turn the
returned transcript into a compact, actionable post-call record.

`call-summarizer` is a post-call analysis skill. It takes a CALL-E call result
that already contains a transcript, runs locally with no additional phone calls
and no network access, and emits a single structured brief: a one-line outcome,
a masked summary of the conversation, the action items with owners and due
dates, the caller sentiment, and a redacted caller fingerprint for dedup.

It is a good fit for CALL-E's design: the hard part (the call) is already done,
and the remaining work (turning a long transcript into something an agent can
act on) is pure text analysis that should not require a second provider or a
paid summarization API.

## When To Use

Use this skill for:

- turning a completed CALL-E call transcript into a one-page post-call brief
- extracting action items with owners and due dates from a call
- surfacing caller sentiment so a follow-up can be triaged correctly
- producing a masked summary that is safe to log, store, or hand to a human
- building a redacted caller fingerprint for de-duplicating repeat callers
- any workflow where the call is done and the record is the deliverable

## When Not To Use

Do not use this skill to:

- place, schedule, or cancel a phone call; it only reads transcripts
- summarize a call that has no transcript; it will abstain instead of inventing one
- act on the action items; it reports them, the operator decides whether to execute
- store PII; every output is masked and the fingerprint is one-way hashed
- replace a human review for medical, legal, financial, or emergency content
- run during the call; it is strictly post-call and never affects call behavior

## Workflow

### 1. Collect the call result

Required: a CALL-E call result containing a `transcript` field (the full
dialogue turns between the agent and the callee). The transcript may be plain
text or a list of turns; both are handled.

Confirm with the operator that this transcript belongs to a call they
authorized and that they want a post-call brief generated. Never run this skill
on a transcript whose origin is unknown.

### 2. Generate the brief locally

Run `scripts/summarize_call.py` on the transcript. By default it reads from a
file path and prints the brief to stdout; it makes no network calls and places
no calls.

```bash
python3 scripts/summarize_call.py --transcript path/to/transcript.json --out brief.json
```

The script performs:

1. **Outcome line**: a single sentence stating the call result (confirmed,
   declined, rescheduled, no-answer, voicemail, unknown) using only words that
   appear in the transcript. The outcome is bound to the callee's latest
   effective response (agent text never counts as a confirmation), and any
   contradictory intent — across utterances or within a single utterance
   (e.g. "Yes, I can't make it") — fails closed to `unknown`.
2. **Masked summary**: a short prose summary with all phone numbers, email
   addresses, names, and account identifiers replaced by masked tokens so the
   summary is safe to log.
3. **Action items**: each commitment, follow-up, or next step extracted with an
   owner (the party who said they would do it), a verb, and an optional due
   date parsed from natural-language time references. Ambiguous items keep
   `owner: unknown` rather than guessing.
4. **Sentiment**: a coarse label (`positive`, `neutral`, `negative`, `mixed`)
   with a short justification span from the transcript. It never reports a
   sentiment the transcript does not support.
5. **Caller fingerprint**: a one-way hash of a stable caller identity input
   (the masked caller phone number, or an explicit `caller_id` field if
   provided). The `call_id` is deliberately excluded so the same caller
   produces the same fingerprint across calls, enabling de-duplication without
   storing PII.

### 3. Validate the brief

Run `scripts/validate_brief.py` to confirm the brief is well-formed before any
downstream system consumes it. It checks that every action item has an owner,
that masking has no residual raw phone numbers, emails, account identifiers,
or personal names, and that the outcome line is non-empty and grounded in the
transcript.

### 4. Review or route

Return the brief to the operator or the calling agent. The skill does not
execute any action item; it only reports them. Routing decisions (escalate,
follow up, close the ticket) stay with the operator or the host agent.

## Output Schema

The brief is a single JSON object:

```json
{
  "outcome": "Appointment confirmed for Tuesday 10:00.",
  "summary": "The callee confirmed the appointment and asked for a reminder the day before.",
  "actions": [
    {
      "owner": "agent",
      "verb": "send reminder",
      "due": "2026-09-15",
      "source_span": "I will send a reminder the day before."
    }
  ],
  "sentiment": {
    "label": "positive",
    "justification": "Callee confirmed without hesitation."
  },
  "caller_fingerprint": "sha256:9f2c...",
  "masked": true
}
```

## Safety Rules

Read `references/safety.md` for the full safety contract.

- This skill never places a call and never modifies call state.
- Every output is masked: phone numbers, emails, and account IDs are tokenized.
- The caller fingerprint is a one-way hash; the raw identity is never stored.
- Action items are reported, not executed. Medical, legal, financial, and
  emergency commitments are flagged as `category: sensitive` and routed to a
  human rather than auto-dispatched.
- If the transcript is empty, garbled, or does not support an outcome, the skill
  abstains with `outcome: unknown` and an empty `actions` list. It never invents
  a plausible outcome.
- No PII leaves the local process. There is no network call and no third-party
  summarization API.

## Requirements

- Python 3.9 or newer. The skill uses only the Python standard library, so no
  `pip install` is required for the default (no-call) path.
- A CALL-E call result with a transcript. Live calls are out of scope; see the
  `call-reminder` or `verify-by-phone` skills for placing calls.

## Quick Start

```bash
# Dry run on the bundled example transcript (no calls, no network).
python3 scripts/summarize_call.py \
  --transcript references/example-transcript.json \
  --out /tmp/brief.json

# Validate the brief.
python3 scripts/validate_brief.py --brief /tmp/brief.json
```

## Examples

See `references/examples.md` for worked examples on different call types
(confirmation, reschedule, no-answer, voicemail) and the expected brief for
each.

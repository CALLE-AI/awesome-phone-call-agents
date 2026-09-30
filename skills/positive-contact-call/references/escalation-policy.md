# Escalation policy

The ladder, the timing rules, and the table that turns one verified call into exactly one
disposition.

## Default policy

```json
{
  "ladder": [
    { "step": 1, "target": "primary", "delay_minutes": 0 },
    { "step": 2, "target": "primary", "delay_minutes": 45, "only_if": ["no_answer", "busy", "voicemail"] },
    { "step": 3, "target": "alternate", "delay_minutes": 0, "only_if_alt_present": true },
    { "step": 4, "target": "primary", "delay_minutes": 180, "only_if": ["no_answer", "busy", "voicemail"] }
  ],
  "max_calls_per_contact": 4,
  "quiet_hours_local": { "start": "21:00", "end": "08:00" },
  "quiet_hours_emergency_override": false,
  "field_visit_cutoff_hours_before_window_start": 6,
  "confidence_threshold": 0.80,
  "supported_locales": ["en-US"],
  "unsupported_locale_action": "needs_human_bilingual_callback"
}
```

Store it per event, print it in the preflight preview, and change it deliberately.

## How the ladder moves

A step whose `only_if` does not match the last outcome is **skipped, not fatal**. A live
person who did not acknowledge is not a no-answer, so the retry step is skipped and the
alternate contact is tried instead. The ladder ends only when no remaining step applies.

`only_if_alt_present` steps are skipped when there is no alternate number, rather than
dialling the primary twice under a different step number.

Each step gets its own idempotency key, derived from
`{event}:{contact}:{ladder_step}:{target}`. Steps are separate authorizations; retries
within a step are not.

## Timing

- **Quiet hours** are evaluated in the recipient's own IANA timezone. A step that lands
  inside them is deferred to the first callable minute, not dropped.
- **The field-visit cutoff** defaults to six hours before the notice window opens. That is
  the last moment a physical visit can still be useful.
- **Before scheduling any step**, check that it could actually complete before the cutoff.
  A step that would land too late is not attempted; the contact goes straight to the
  field-visit queue. Starting a call whose result arrives after the deadline burns the
  slot without informing anyone.
- **`max_calls_per_contact`** is a hard ceiling across every step and every retry.

## Human review does not pause the deadline

A contact under human review is still on the clock. If nobody resolves it before the
field-visit cutoff, it becomes a pending field visit automatically. Review pauses the
automation, never the deadline. This is the rule most often lost in implementations, and
losing it means an item sits in a queue while the deadline passes silently.

## Outcomes that never redial

- **Wrong number.** The number is retired for the event. No step dials it again.
- **Refused.** The person said stop. Nothing dials them again.
- **Language barrier.** Not retried automatically, and never retried in another language.
  It becomes a bilingual human callback.

## The disposition table

Read in order; the first matching row wins.

| Terminal status | contact_type | acknowledged | Confidence | Judges agree | Disposition |
| --- | --- | --- | --- | --- | --- |
| not a clean completion | any | any | any | any | NEEDS_HUMAN, no auto redial |
| completed | result missing or invalid | | | | NEEDS_HUMAN |
| completed | transcript shows a machine greeting while the result claims a live acknowledgement | | | | NEEDS_HUMAN (contradiction) |
| completed | wrong_number | any | any | any | NEEDS_HUMAN, number retired for the event |
| completed | refused | any | any | any | NEEDS_HUMAN, no redial |
| completed | language_barrier | any | any | any | NEEDS_HUMAN, bilingual callback, no redial |
| completed | any | any, with needs_assistance = medical_question | any | any | NEEDS_HUMAN, priority; the contact outcome is still recorded |
| completed | live_person | yes | at the gate | yes | **CONFIRMED** |
| completed | live_person | yes | at the gate | no | NEEDS_HUMAN (disagreement), ladder clock still running |
| completed | live_person | yes | below the gate | any | NEEDS_HUMAN |
| completed | live_person | no or unknown | any | any | UNCONFIRMED, next step |
| completed | voicemail | any | any | any | UNCONFIRMED, notice left, next step |
| completed | no_answer or busy | any | any | any | UNCONFIRMED, retry |
| completed | unknown | any | any | any | NEEDS_HUMAN |

## The judges

**Judge A, structured.** Rule-based over the recipient's structured result and the call
status. It never guesses voicemail from a status value, because the platform publishes no
answering-machine indicator.

**Judge B, transcript.** Looks for an acknowledgement in a recipient turn that comes
**after** the notice turn, in the recipient's locale, and records the exact span as
evidence. A recipient turn matching an answering-machine greeting marks voicemail whatever
Judge A says. A "yes" answering the greeting question is not an acknowledgement of the
notice.

**Judge C, optional.** A model-based third opinion, off by default, behind an explicit
switch, consulted only when A and B disagree. It never overrides an agreement, and its
output is a note for the reviewer rather than a verdict.

**Agreement** means both judges independently reached the same read. An `unknown` from
Judge B is not agreement. A confirmation therefore always has a transcript span behind it.

**The confidence gate** passes on a `high` label or a score at or above the threshold. A
missing confidence object, a missing score, and an unrecognised label all fail it.

## Ambiguity is a state, not an error

A submission whose outcome is unknown is not retried with a fresh key. It is recorded as
unknown, and reconciled by replaying the identical key with the identical body, which the
transport contract answers with the original call if one exists. If it cannot be
reconciled, a person owns it. The ladder never advances past an unknown submission.

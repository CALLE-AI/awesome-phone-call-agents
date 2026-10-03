---
name: provenance-grade
description: Attach an advisory knowledge grade — verified / asserted / assumed — to fields a CALL-E phone agent extracts, using heuristic signals in the transcript turns the API returns.
---

# provenance-grade

Every phone agent extracts **what** was said and throws away **how the speaker knew it**.

Speech carries the speaker's epistemic state; text hides it. Structured extraction
throws that signal away. This skill puts it back: it reads
`recipients[i].attempts[j].transcript_turns` from a completed CALL-E call and attaches
a knowledge grade to every extracted field, with the exact transcript span that
supports it.

This skill **never places calls**: it lints a task before a host dispatches it and
grades a transcript after a call has completed. It contains no dialing code, no
phone numbers, and no network calls of any kind.

Two calls can both answer *"Tuesday."* In one, the person said *"hold on, let me
check"*, went quiet for eleven seconds, and came back with *"Tuesday — we're holding
eleven units at the Bhiwandi warehouse."* In the other, they said *"should be
Tuesday"* half a second after the question. Same extracted value. Completely different
knowledge. The first is `verified`; the second is `assumed` — and if your workflow
auto-commits on the second one, the extraction was correct and the answer was still
wrong.

## Why this is not a duplicate of anything in this repo

CALL-E already returns `completion_confidence` — but by its own documentation that is
confidence that **the task reached a clear end state**, explicitly *not* confidence in
the quality of the business answer. That is a documented, self-acknowledged gap, and
this skill fills exactly it.

Against the other skills here: `call-summarizer` summarises after the fact.
`voice-preflight` checks audio before the call. `linecanary` monitors line health.
**Nothing grades the epistemic basis of a spoken claim.**

## The grades

| Grade | Meaning |
|---|---|
| `verified` | The heuristic detects a lookup pause or explicit check language, **plus** an unrequested corroborating specific, **plus** read-back compliance where requested. This label is not proof that a lookup occurred or that the answer is true. |
| `asserted` | Answered directly and cleanly, but nothing established where the value came from. |
| `assumed` | Hedged, deferred, misaligned with the question, or a bare round number. The call did not establish this value. |
| `unstated` | The field never appeared in the transcript (voicemail, IVR, unanswered question). Never a grade — there is nothing to grade. |

**Consumer rule:** grades are advisory inputs to the host's own validation, not
independent authorization to act. Keep a human in the loop for `asserted`, and
never auto-act on `assumed` or `unstated`. The high-stakes prohibitions in
[references/safety.md](references/safety.md) apply to every grade, including `verified`.

**Fail-closed:** the default is `assumed`. `asserted` must be earned, `verified` must
be earned twice. Absence of signal never upgrades a field. This is the same
discipline this repo rewards everywhere else, applied one level up.

## Two halves

**Pre-call — `scripts/lint-task.ts`.** Amends the caller's task text and
`result_schema` so the signals are actually elicitable: forces a read-back of
critical values, rewrites *"do you know?"* into *"can you check?"*, asks for one
corroborating specific, and gives the agent permission to wait while the person
looks something up. You improve the signal you will later measure.

```ts
import { lintTask } from './scripts/lint-task.ts';

const { task, result_schema, amendments } = lintTask({
  task: 'Call the supplier. Do you know the unit price and delivery date?',
  result_schema: mySchema,
  critical_fields: ['unit_price', 'delivery_day'],
});
// -> task now asks "can you check", requests a read-back, asks for one specific
```

**Post-call — `scripts/grade.ts`.** Reads the transcript turns and emits a grade plus
the supporting span per field.

```ts
import { gradeCall } from './scripts/grade.ts';

const provenance = gradeCall({
  callId: call.id,
  recipientId: recipient.id, // an ORGANISATION id, never a person
  turns: attempt.transcript_turns, // { speaker, text, offset_seconds }
  fields: [
    {
      field: 'delivery_day',
      value: extracted.delivery_day, // from CALL-E's structured output
      expects: 'weekday',            // duration | weekday | date | price | count | text
      questionTurn: 2,               // where the bot asked
      answerTurns: [4],              // where the person answered ([] if never answered)
      readbackRequested: true,
      critical: true,
    },
  ],
});
// provenance.fields[0] ->
// { field: 'delivery_day', value: 'Tuesday', grade: 'verified',
//   signals: ['A:gap=12.6s', 'B:let me check', "C:stock_count 'eleven units'", "C:place 'Bhiwandi'"],
//   span: 'It ships Tuesday. We are holding eleven units at the Bhiwandi warehouse for you.',
//   turnOffset: 26, unstable: false, gapSeconds: 12.6 }
```

Output contract (`scripts/types.ts`):

```ts
type Grade = 'verified' | 'asserted' | 'assumed' | 'unstated';

interface FieldProvenance {
  field: string;              // "eta_days"
  value: unknown;             // 5
  grade: Grade;
  signals: string[];          // ["B:let me check", "C:place 'Bhiwandi'"]
  span: string;               // exact transcript text supporting the value
  turnOffset: number | null;
  unstable: boolean;          // value was stated then revised (signal I)
  gapSeconds: number | null;
}

interface CallProvenance {
  callId: string;
  recipientId: string;        // organisation-level, never a person
  fields: FieldProvenance[];
  weakestGrade: Grade;        // the call is only as good as its worst critical field
  gradedAt: string;
}
```

## How the grade is computed

Nine signals, described with examples in [references/signals.md](references/signals.md):
retrieval gap (A), explicit check language (B), corroborating specific (C), hedging
lexicon (D), deferral (E), read-back compliance (F), round-number shape (G), answer
alignment (H), self-correction (I). They feed a fixed rule table:

```
if field not present in transcript      -> 'unstated'   (never a grade)
if E or H                               -> 'assumed'
if D present                            -> 'assumed'
if (B or A) and C and (F if requested)  -> 'verified'   (never when unstable)
if answered directly, no D/E/H          -> 'asserted'   (unless G with no C)
otherwise                               -> 'assumed'
```

**Deterministic vs model-assisted — honestly.** Signals A, B, D, E, F, G and I are
regex and arithmetic. Signals C and H need semantics; in this build they run on a
deterministic entity heuristic, and each exposes a provider interface
(`CorroborationProvider`, `AlignmentProvider`) where a model can be plugged in — a
model is constrained to **returning spans, never a grade**. The grade itself is always
computed by the rule table above, never by a model's opinion. That is what makes it
testable: 125 unit tests and a confusion matrix over 24 labelled fixtures, zero calls,
zero network.

```
truth \ pred   verified  asserted  assumed  unstated
verified          4         0         0        0
asserted          0         6         0        0
assumed           0         1         9        0
unstated          0         0         0        4      -> 23/24 (95.8%)
```

The one miss is deliberate and shipped as a fixture: a code-switched answer whose
hedge is the Hindi *"shayad"*, which the English lexicon cannot see
(`assets/fixtures/23-codeswitch-hindi-hedge-missed.json`). A named limitation beats a
silent one. Reproduce with `npm run eval`; run tests with `npm test`.

## Ethics boundary

This skill grades **behaviour, not people.**

- No emotion detection, no stress or deception scoring, no voice biometrics. (Also
  impossible here by construction: CALL-E exposes no audio to grade — only transcript
  text and integer offsets.)
- Hosts should associate grades with an **organisation**, not an individual.
  This pure grader does not enforce identifier contents or anonymize input: values,
  transcript spans and caller-supplied IDs may identify people. The caller must
  minimize inputs and redact display/export copies before sharing them.
- A low grade means *the call did not establish this*, never *this person lied*.
- Transcript spans are retained only as the minimum quote supporting one field.

Full statement: [references/ethics.md](references/ethics.md).

## Limitations

Stated, not hidden — the full list with reasoning is
[references/limitations.md](references/limitations.md). Headlines: `offset_seconds`
marks turn start at integer resolution, so the latency signal is weak and weighted
accordingly; ASR errors corrupt hedge detection; the lexicon is English-centric and
swappable (`scripts/lexicon/en.json`), with the Hindi file (`scripts/lexicon/hi.json`) shipped **unvalidated**;
directness is cultural — a terse answer is not necessarily a guess; and the grades
are not yet validated against outcomes.

## Roadmap (stated, not built)

The grade is a prediction. The validation is: record the grade, wait for the promised
event, record whether it held, and measure grade-vs-outcome accuracy per
organisation. Over enough calls this produces a calibration curve and a per-supplier
reliability score — a supplier whose `asserted` Tuesdays actually arrive on Tuesday
earns trust; one whose `verified` claims fail flags a broken lookup process. None of
that is built and none of it is tested. It is named here because naming the
unvalidated claim is what separates a measure from a demo.

---

*CALL-E tells you the call finished. This tells you whether to believe it.*

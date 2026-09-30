# The nine signals

Input per field: the question turn(s) from `bot`, the answer turn(s) from `user`,
and their `offset_seconds`. Each signal is detected independently and cited in the
output (`signals: ["B:let me check", ...]`) so every grade is auditable back to
transcript text. The grade itself comes only from the rule table in
`scripts/grade.ts` — signals are evidence, never verdicts.

## A — Retrieval gap *(deterministic · upgrade, weak)*

`gap = answer.offset − question.offset − est_speech_secs(question.text)`, where
`est = words / 2.5`. A gap above 6 seconds suggests the person went and looked
something up.

> bot (t=9): "Which day will the fifty units for order 7741 ship out?" *(11 words ≈ 4.4s)*
> user (t=26): "It ships Tuesday…" → gap = 26 − 9 − 4.4 = **12.6s** → A fires.

Known weakness: `offset_seconds` is an integer marking **turn start**, so the gap
absorbs the previous turn's speaking time. A is therefore the weakest upgrade signal
and never counts alone — the rule table requires C alongside it.

## B — Explicit check language *(deterministic · upgrade, strong)*

"Hold on", "let me check", "one second", "let me pull that up", "checking now" in a
`user` turn between the question and the answer (inclusive of the answer turn —
people say "let me check — yes, eleven units" in one breath). Phrases live in the
swappable lexicon (`scripts/lexicon/en.json`) and match on word boundaries, so
"holding" never triggers "hold on".

## C — Corroborating specific *(model-assist slot · upgrade, strong)*

The answer volunteers a specific entity that was **not** requested — a stock count,
a warehouse name, a part number, an invoice reference, an exact date. People who
just read a screen tend to leak what they saw.

> Asked for a weekday, answered: "It ships Tuesday. We are holding **eleven units**
> at the **Bhiwandi** warehouse." → two corroborating specifics.

Default implementation is a deterministic entity heuristic (`signals/entities.ts`).
A model may replace it through `CorroborationProvider`, constrained to returning
**spans** — the class and text of what it found — never a grade.

## D — Hedging lexicon *(deterministic · downgrade to assumed)*

"should be", "I think", "usually", "normally", "typically", "probably", "around",
"roughly", "about", "more or less", "I'd say" in the answer turns. Any hit drops the
field to `assumed`. English-centric by construction; see limitations.

## E — Deferral *(deterministic · downgrade to assumed, hard)*

"I'll have to confirm", "let me get back to you", "my colleague handles that". The
speaker told us themselves that they cannot stand behind the value. Hard downgrade —
no other signal can rescue a deferred field.

## F — Read-back compliance *(deterministic · required for verified when requested)*

After the answer, the bot reads the value back; complied means the person **repeated
the value**, not just said "yeah" — a bare acknowledgement costs nothing and confirms
nothing. Number comparison is comma-insensitive ("4,500" ≡ "4500"). The pre-call lint
inserts read-back requests for critical fields precisely so this signal exists to
measure. When a read-back was requested and refused, `verified` is unreachable.

## G — Round-number shape *(deterministic · downgrade, mild)*

"about a week", "five days", "a couple of days" read like estimates; "4 business
days" or "Thursday the 18th" read like schedule entries. Round day-counts
(5/10/15/20/30 without a "business" qualifier), single weeks/months, and flat
multiples of ₹1000 count as round. Mild: it only bites when no corroborating
specific (C) is present.

## H — Answer alignment *(model-assist slot · misaligned ⇒ assumed)*

Does the answer turn contain the entity **type** that was asked for? Asked a price
and got "we can ship it Tuesday" → misaligned → `assumed`, regardless of what the
extractor managed to pull out. Like C, the default is the entity heuristic and a
model may substitute through `AlignmentProvider` — spans only. Fields typed `text`
cannot be checked and pass by default.

## I — Self-correction *(deterministic · flags unstable, blocks verified)*

A value stated then revised: "Five days. Actually, no wait, six days." Fires when a
correction phrase co-occurs with two distinct candidate values of the asked type.
The final value is taken, the field is flagged `unstable`, and `verified` becomes
unreachable — even if every upgrade signal is present (fixture 12 proves this path).

## The rule table

```
if field not present in transcript      -> 'unstated'   (never a grade)
if E or H                               -> 'assumed'
if D present                            -> 'assumed'
if (B or A) and C and (F if requested)  -> 'verified'   (never when unstable)
if answered directly, no D/E/H          -> 'asserted'   (unless G with no C)
otherwise                               -> 'assumed'
```

Default is `assumed`. `asserted` must be earned, `verified` must be earned twice
(a lookup indicator **and** a corroborating specific). Absence of signal never
upgrades.

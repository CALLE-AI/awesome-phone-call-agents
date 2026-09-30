# Hazard-conditioned triage

Deterministic. No model. The output is not a number — it is a list of sentences a volunteer can act on, which happen to be sortable.

## The rule that shapes everything else

**Risk is a property of (person × hazard), never of a person.**

Do not put a `risk_level` column on the roster. It would be wrong half the time:

| | Heat warning, 114F, 41% humidity | Power outage, 6h estimate, 108F |
| --- | --- | --- |
| 75+, alone, **swamp cooler**, no car | **critical — first call of the evening** | high |
| 65-74, alone, **oxygen concentrator, 4h battery**, wheelchair | critical | **critical, and 4 hours from harm** |
| 82, bedbound, **insulin in the refrigerator** | critical | critical |

Nothing about those people changed between the two columns. The hazard did. If your engine cannot produce two different orders from the same roster, it is not triaging, it is ranking frailty.

## Parse the hazard first, once, and never raise

The facts arrive from wherever the coordinator got them: a weather product, a utility outage map, a form somebody typed into. Normalise into a frozen profile — kind, severity, and the handful of typed facts the rules compute on — **once per sweep**, so every person is scored against exactly the same picture.

Nothing in this parsing may raise. A missing temperature, `"114"` as a string, a hand-typed `"about six"` for the outage estimate: all degrade to "unknown", and triage says so out loud in the reasons. A crash here means the whole roster goes uncalled, which is far worse than an imprecise score.

**Model the physics that actually changes the answer.** The worked example: an evaporative ("swamp") cooler is not an air conditioner. It cools by evaporating water into the airstream, so its output collapses as humidity rises — 25 degrees of cooling in dry desert air, a few degrees and some damp when the monsoon arrives. So `108F at 15% humidity` and `108F at 45% humidity` are different hazards for the same person, and humidity is not decoration. Express it as a curve that is monotonically non-increasing in humidity, and make a missing humidity reading return a middling value rather than optimism.

Derive and expose, alongside the raw facts: does this hazard cut power, might it end in leaving the house, is an evaporative cooler compromised, what is the effective restoration estimate **and was it assumed rather than given**.

## Building a score you can defend

1. **The hazard's rule runs** and appends `(points, reason)` pairs. One rule per hazard kind, plus a generic rule for a kind you have no rules for — an unrecognised hazard still gets swept, scored conservatively.
2. **Severity multiplies the total**, it does not add. State each contribution as what it is worth in a full-blown warning and scale by severity (advisory 0.6 → emergency 1.25). An advisory then needs no hand-tuned constants of its own, and nobody can quietly retune one hazard into another's thresholds.
3. **Cap the subtotal before amplifiers.** Without a ceiling, a long conditions list multiplies through and lands half the roster at an undifferentiated maximum, which tells the coordinator nothing about who to ring first.
4. **Amplifiers apply to the subtotal and never to a subtotal of zero.** Living alone is not a danger in itself — it is what turns somebody else's bad night into an unwitnessed one. Same for age.
5. **Everyone gets base points.** A zero would read as "no need to ring her".
6. **The ceiling and any band floor go in as visible factors**, so the invariant holds: **the score always equals the sum of its reasons.** A silent clamp breaks the breakdown that makes the whole thing auditable.

Bands are thresholds on the score: routine, elevated, high, critical.

## Band floors

Some situations must not be sortable below a band no matter what the arithmetic says, and a constant retuned next week must not be able to move them. Pin a minimum band with the sentence that justifies it:

- *"the concentrator is dead the moment the power is"* → critical
- *"the concentrator fails before the power returns"* → critical
- *"battery margin is under two hours"* → high
- *"on life-support equipment during an outage"* → elevated

## Time to harm is a subtraction, not a flag

The sharpest thing the engine can know. Not *"is this person power-dependent"* but *"how long does their equipment last against how long the power is out"*:

| | points | floor | clock |
| --- | --- | --- | --- |
| no battery at all | highest | critical | 0 |
| battery **<** outage estimate | high | critical | the battery hours |
| battery < estimate + 2h | moderate | high | the battery hours |
| battery comfortably covers it | low | elevated | the battery hours |

Eight hours of battery against a two-hour outage is a phone call. Two hours against a six-hour outage is a countdown. When the hazard gave no estimate, assume one from severity and **put a zero-point factor in the list saying you did** — the coordinator must be able to see which numbers were yours.

`time_to_harm = null` means **no clock, not no risk**. Insulin in a refrigerator is a serious fact with no battery attached to it; flagging that person power-dependent would invent a deadline they do not have.

## Vocabulary a volunteer typed

`conditions` arrives as free text: `"COPD"`, `"heat sensitive"`, `"oxygen-dependent"`, `"insulin"`, `"high blood pressure"`. Normalise to canonical tokens, and then handle the three cases:

- a condition this hazard has a rule for → the table value. Keep the table readable per hazard: COPD is a moderate contribution in heat and a large one in smoke, and reading down that column is how someone checks your reasoning.
- a known condition this hazard has no rule for → a small contribution. It is on the card because someone thought it mattered.
- **a condition you do not recognise at all → never zero.** A small conservative contribution and the card quoted back verbatim: *`"high blood pressure" on file — no rule for that one, so it is scored conservatively and left for you to read.*

Scoring an unrecognised health condition as zero is the one failure mode this cannot have.

Normalise the enumerated fields the same way — cooling, heating, mobility, age band. "Evaporative cooler", "evap" and "swamp cooler" are the same box on the same roof, and matching only one spelling makes the most important fact about that house silently disappear from both the score and the reasons.

## Order, and who is dropped

Sort by score, then by the clock (a two-hour battery outranks an eight-hour one at the same score), then by a stable tiebreak so a shuffled roster cannot reorder. Same inputs, same output, every time: a triage that reshuffles between two runs is a triage nobody trusts.

**Order is the part that survives contact with reality.** The call budget is finite, a volunteer's evening is shorter than the list, and a sweep can die halfway through. Whatever fraction of the roster actually gets called has to be the right fraction: if only six calls happen tonight, those six should be the six where a call changes the outcome.

People who have not consented are **dropped when the order is built**, not sorted to the bottom where an off-by-one can reach them — and they still appear in the roster output, with the reason.

## Degrade, do not crash

A roster row missing half its fields, an unparseable number, a condition token nobody has seen: all produce a conservative score and a reason naming what was not understood. Every failure in this module has the same consequence — a whole block goes uncalled — so it is written to be total.

## Privacy

The assessment contains health facts about a named person by design, and it is stored on the call record so the answer to *"why was he called first?"* survives the evening. Redact at egress, never in the engine. Do **not** hand this object to the call contract: build a deliberately thin view for that, with derived facts only.

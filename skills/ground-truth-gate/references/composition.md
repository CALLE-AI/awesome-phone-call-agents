# Composition With Existing Skills

This skill deliberately does not implement everything it needs. Three neighbours already own rules that would otherwise be duplicated here.

## Abstention belongs to verify-by-phone

`skills/verify-by-phone/scripts/gate.py` implements a split conformal abstention gate over `yes`, `no`, and `unknown`: with a calibration fold of size n and a miscoverage level alpha, it answers only when the calibrated prediction set is a singleton and that singleton is not `unknown`.

That is a stronger rule than a hardcoded confidence floor, and its own docstring records why it exists: the threshold had previously been written twice, in two places, with two different values, so the abstention the skill advertised was not the abstention it performed.

So this skill does not own a confidence number. `release(verdict, abstain)` takes the abstain decision as an input:

```python
release("confirmed_true", abstain=True)   # False, the calibrated set won
release("confirmed_true", abstain=False)  # True
release("unknown",        abstain=False)  # False, unknown is never positive evidence
release("confirmed_true", abstain=None)   # False, no calibration answer is not a pass
```

That last line is the one that matters in practice. An unwired handoff produces `None`, not `False`, and a gate that treated a missing signal as permission would release exactly when it knows least. Only an explicit `False` releases.

### The handoff, concretely

The two skills use different label spaces, so the mapping is written here rather than left to the caller. This skill's four verdicts collapse onto `verify-by-phone`'s three classes:

| This skill's verdict | `verify-by-phone` class |
| --- | --- |
| `confirmed_true` | `yes` |
| `confirmed_false` | `no` |
| `refused_to_answer` | `unknown` |
| `unknown` | `unknown` |

`qhat` comes from a calibration fold, once per deployment, not once per call:

```bash
python3 ../verify-by-phone/scripts/calibrate.py --data calibration.jsonl --alpha 0.1
```

Then, per returned call:

```python
import sys; sys.path.insert(0, "../verify-by-phone/scripts")
import gate as vbp

label = {"confirmed_true": "yes", "confirmed_false": "no"}.get(verdict, "unknown")
scores = vbp.class_scores(label, trust)          # trust from the extraction step
abstain = vbp.abstains(scores, label, qhat)      # qhat from calibrate.py
released = release(verdict, abstain)
```

`python3 scripts/gate.py --reconcile RESULT.JSON --abstain true|false` is the same decision at the command line, and omitting `--abstain` withholds rather than releases.

Two rules, cleanly split. What counts as positive evidence is categorical and lives here. How much confidence is enough is calibrated and lives there.

## Claim shape is not contact verification

`verify-contact-claim` answers a different question: did an institution really contact this person. It dials only the number on the user's own card, never the number that contacted them, and its outcomes are about a contact event.

This skill answers whether a fact about the world is currently true, and dials the party whose word is binding on that fact. Same safety posture, different question. Neither subsumes the other.

## Recurrence belongs to the host scheduler

A confirmed verdict expires. Re-checking it on a cadence is a scheduling problem, and repository Principle 2 keeps scheduling out of the calling path: the host scheduler handles recurrence, and the provider places exactly one call per run.

So this skill has no cadence, no cron, and no internal timer. A claim needing periodic re-confirmation re-enters triage from a scheduled run, and `call-reminder` documents that wrapper pattern.

## The nearest neighbour is local-atlas, and it is close

`apps/web/local-atlas/docs/calls-not-placed.md` opens: "Most of the work in a phone-call feature that touches strangers is deciding not to dial." That is this skill's thesis, written first and merged already. `fact-freshness.md` next to it expires an answered fact after `CALLE_FAQ_TTL_DAYS`, default 90 - the same staleness horizon this skill picked independently. Anyone evaluating this skill should read both before believing any novelty claim made here.

The overlap is real and the difference is one step later in the pipeline:

| | `local-atlas` | this skill |
|---|---|---|
| Question being answered | should we dial at all | may this answer be released as fact |
| Unit of reuse | a shared FAQ corpus; one visitor's call becomes every later visitor's fact | one claim record belonging to one asker |
| What a completed call produces | the answer, stored and served until TTL | a candidate, which still has to pass `release()` |
| What happens on an inconclusive call | there is no such state; the call answered or it did not | `unknown` is a first-class outcome and the provisional answer stands, untouched |

`local-atlas` refuses to dial and is finished. This skill assumes the call may already have happened, and gates what comes back: an answered call is not yet a fact, and absence of evidence never becomes one. That is the whole reason `release()` takes an abstention decision as an input rather than reading a confidence number itself.

## Durable webhook delivery belongs to webhook-result-receiver

`apps/python/webhook-result-receiver` already implements the receiving half of the runtime workflow, and implements it better than a skill script should: SQLite receipts, at-least-once delivery with event-ID deduplication, a conflict on a repeated ID carrying a different payload, and an authenticated `GET /v1/calls/{id}` before any delivery is accepted.

This skill deliberately ships no receiver. Its rule - the webhook body is a hint, the re-fetch is the truth - is that app's rule, and two implementations of one rule are two rules. `gate.py --reconcile` takes the object the re-fetch returned, which is exactly what that receiver hands over.

## What is left that is genuinely new here

- Triage before the call: deciding whether a call is warranted at all, from scope mismatch, evidence age, and the cost of being wrong. The neighbours all assume the decision to verify has already been made.
- The scope narrowing rule: evidence at carrier level does not answer a plan level question. This is the failure a careful hedging agent still commits, because quoting the source feels like sourcing the claim.
- Asynchronous correction with provenance: a provisional answer now, and a write back later carrying the quote, the party, the confidence input, and the time.

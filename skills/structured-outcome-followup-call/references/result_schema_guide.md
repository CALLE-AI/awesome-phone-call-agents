# Writing a `resultSchema` CALL-E can reliably fill

CALL-E is goal-driven: instead of a rigid script, you give it a task description and a JSON
schema describing the structured result you want back, and it plans and adapts the
conversation to fill that schema. Getting reliable structured answers back depends more on how
you write the task and schema than on anything else in this pattern.

## 1. Keep the question list short and closed-ended where possible

Every `CallQuestion` in this skill maps to one field in the result schema. Prefer questions
with a small answer space (yes/no, a 0-10 scale, a short enum) over open-ended ones — CALL-E
can still ask a natural follow-up if the recipient's answer is ambiguous, but the schema should
describe what you actually need to make a decision, not a transcript of the whole call.

## 2. One field, one concrete concept

Don't combine two concepts into one field ("was the package received and in good condition?")
— split it into two questions/fields. This keeps your rubric (see the main SKILL.md) simple:
each rule can check one field's value without needing to parse a compound answer.

## 3. Translate your question list into the task prompt explicitly

CALL-E doesn't need your `resultSchema` restated as a script — it needs a task description
that tells it what to accomplish and what data to come back with. A reasonable pattern:

```
You are calling {subject_name} about {context}. Be warm and brief. Ask the
following, in a natural order, and make sure you get a clear answer to each
before ending the call:
- {question 1 prompt}
- {question 2 prompt}
- {question 3 prompt}
```

Pair this with a `resultSchema` whose required properties match your question keys exactly, so
there's no ambiguity between what you asked for in the task and what you're parsing out of the
result.

## 4. Handle missing/ambiguous answers explicitly in your rubric, not by hoping they don't happen

A real call can end without every field being filled (recipient hangs up early, gives an
unclear answer, etc.). Decide up front what your rubric does with a missing field — treating it
as the more concerning answer (rather than silently skipping it) is usually the safer default,
the same way this pattern's healthcare-derived origin treats a missing pain-level answer as
worth a look rather than ignoring it.

## 5. Test with the mock provider before writing your real rubric

Because `MockVoiceProvider` lets you force a scenario's answers, you can validate your rubric's
thresholds against known inputs before a single real call happens — see
`scripts/orchestrate_example.py` for the pattern.

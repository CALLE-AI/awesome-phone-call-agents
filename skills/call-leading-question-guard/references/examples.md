# Examples: call-leading-question-guard

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: a pickup date affirmed under a tag question (LEADING_TAINTED)

Fixture: `references/example-transcript.json` - the agent plants "Friday"
with ", right?", the person agrees, and the affirmed value is marked as
tainted elicitation. A later negative interrogative gets an affirmation
with no value, so it does not taint.

Command:

```bash
python3 skills/call-leading-question-guard/scripts/leading_question_guard.py analyze \
  --transcript skills/call-leading-question-guard/references/example-transcript.json
```

Output:

```json
{
  "call_id": "run-lead-tainted",
  "skill": "call-leading-question-guard",
  "analysis_mode": "heuristic",
  "elicitation_assessment": "assessed",
  "reason": null,
  "questions_total": 3,
  "questions": [
    {
      "turn_index": 2,
      "kind": "TAG",
      "leading": true,
      "sentence": "You can pick up your prescription on Friday, right?"
    },
    {
      "turn_index": 5,
      "kind": "NEGATIVE_INTERROGATIVE",
      "leading": true,
      "sentence": "Don't you want to keep the auto-refill going?"
    },
    {
      "turn_index": 7,
      "kind": "OPEN",
      "leading": false,
      "sentence": "What time works best for you?"
    }
  ],
  "tainted_elicitation": [
    {
      "turn_index": 3,
      "question_kind": "TAG",
      "value": "friday",
      "sentence": "Yes, Friday works."
    }
  ],
  "verdict": "LEADING_TAINTED",
  "recommended_action": {
    "action": "reask_neutrally_before_booking",
    "guidance": "At least one affirmed value came from a leading question. Re-confirm that value with a neutral question before it drives any booking or record update."
  },
  "disclaimer": "Lexical question-form heuristics. A flagged form is not proof the answer was coerced - a confident person may genuinely agree. Findings route to review, never auto-invalidate a result."
}
```

## Example 2: open questions plus one bounded closed confirmation (NEUTRAL_ELICITATION)

Fixture: `references/example-transcript-neutral.json` - open elicitation
first, then a plain "Should I..." confirmation that matches no leading
family.

Command:

```bash
python3 skills/call-leading-question-guard/scripts/leading_question_guard.py analyze \
  --transcript skills/call-leading-question-guard/references/example-transcript-neutral.json
```

Output:

```json
{
  "call_id": "run-lead-neutral",
  "skill": "call-leading-question-guard",
  "analysis_mode": "heuristic",
  "elicitation_assessment": "assessed",
  "reason": null,
  "questions_total": 3,
  "questions": [
    {
      "turn_index": 2,
      "kind": "OPEN",
      "leading": false,
      "sentence": "What day works best for pickup?"
    },
    {
      "turn_index": 4,
      "kind": "OPEN",
      "leading": false,
      "sentence": "What time of day?"
    },
    {
      "turn_index": 6,
      "kind": "CLOSED",
      "leading": false,
      "sentence": "Should I set it for Friday at 10 a.m.?"
    }
  ],
  "tainted_elicitation": [],
  "verdict": "NEUTRAL_ELICITATION",
  "recommended_action": {
    "action": "continue",
    "guidance": null
  },
  "disclaimer": "Lexical question-form heuristics. A flagged form is not proof the answer was coerced - a confident person may genuinely agree. Findings route to review, never auto-invalidate a result."
}
```

## Example 3: leading form, but the person pushes back (LEADING_QUESTIONS_DETECTED)

Fixture: `references/example-transcript-leading-untainted.json` - the
double-barreled "Obviously you'd want the earlier slot, wouldn't you?"
classifies as TAG (tag check runs first), but the callee names their own
value instead of affirming, so nothing is tainted.

Command:

```bash
python3 skills/call-leading-question-guard/scripts/leading_question_guard.py analyze \
  --transcript skills/call-leading-question-guard/references/example-transcript-leading-untainted.json
```

Output:

```json
{
  "call_id": "run-lead-untainted",
  "skill": "call-leading-question-guard",
  "analysis_mode": "heuristic",
  "elicitation_assessment": "assessed",
  "reason": null,
  "questions_total": 2,
  "questions": [
    {
      "turn_index": 2,
      "kind": "TAG",
      "leading": true,
      "sentence": "Obviously you'd want the earlier slot, wouldn't you?"
    },
    {
      "turn_index": 4,
      "kind": "OPEN",
      "leading": false,
      "sentence": "When works best for you?"
    }
  ],
  "tainted_elicitation": [],
  "verdict": "LEADING_QUESTIONS_DETECTED",
  "recommended_action": {
    "action": "review_question_forms",
    "guidance": "Leading question forms were used. Prefer open-form questions at decision points; re-ask neutrally if a key value rests only on a leading question."
  },
  "disclaimer": "Lexical question-form heuristics. A flagged form is not proof the answer was coerced - a confident person may genuinely agree. Findings route to review, never auto-invalidate a result."
}
```

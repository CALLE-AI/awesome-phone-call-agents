# Examples: call-data-minimization-auditor

All outputs below are byte-real CLI runs from the repository root.

## Analyze a minimal call

Goal scope: `full_name`, `phone_number`. The agent asks exactly those two,
confirms the number masked, never re-asks.

```bash
python3 skills/call-data-minimization-auditor/scripts/data_minimization_auditor.py analyze \
  --transcript skills/call-data-minimization-auditor/references/example-transcript.json \
  --goal-file skills/call-data-minimization-auditor/references/example-goal.txt
```

```json
{
  "call_id": "demo-minimization-001",
  "verdict": "MINIMAL",
  "requests": [
    {
      "turn_index": 0,
      "category": "full_name",
      "sensitivity": "standard",
      "scope": "in_scope",
      "redundant": false,
      "echo": false,
      "sentence": "Can I have your full name, please?"
    },
    {
      "turn_index": 2,
      "category": "phone_number",
      "sensitivity": "standard",
      "scope": "in_scope",
      "redundant": false,
      "echo": false,
      "sentence": "And what's the best number to reach you?"
    }
  ],
  "counts": {
    "requests": 2,
    "out_of_scope": 0,
    "redundant": 0,
    "echo": 0,
    "high_sensitivity": 0
  },
  "goal_scope_categories": [
    "full_name",
    "phone_number"
  ],
  "disclaimer": "Heuristic lexical audit against the goal file only. The goal file is the sole ground truth for scope; a category the goal omits may still be lawful to collect, and paraphrases outside the lexicon are missed. High-sensitivity tags are advisory, not a legal determination. Findings route to review."
}
```

## Analyze an overcollection call

Same goal scope, but the agent also asks for a date of birth, re-asks the
name Dana already gave without a hearing excuse, and repeats the full card
number after the callee read it.

```bash
python3 skills/call-data-minimization-auditor/scripts/data_minimization_auditor.py analyze \
  --transcript skills/call-data-minimization-auditor/references/example-transcript-overcollection.json \
  --goal-file skills/call-data-minimization-auditor/references/example-goal.txt
```

```json
{
  "call_id": "demo-minimization-001",
  "verdict": "OVERCOLLECTION_DETECTED",
  "requests": [
    {
      "turn_index": 0,
      "category": "full_name",
      "sensitivity": "standard",
      "scope": "in_scope",
      "redundant": false,
      "echo": false,
      "sentence": "Can I have your full name, please?"
    },
    {
      "turn_index": 2,
      "category": "phone_number",
      "sensitivity": "standard",
      "scope": "in_scope",
      "redundant": false,
      "echo": false,
      "sentence": "And what's the best number to reach you?"
    },
    {
      "turn_index": 4,
      "category": "date_of_birth",
      "sensitivity": "standard",
      "scope": "out_of_scope",
      "redundant": false,
      "echo": false,
      "sentence": "Before we finish, can you verify your date of birth?"
    },
    {
      "turn_index": 6,
      "category": "full_name",
      "sensitivity": "standard",
      "scope": "in_scope",
      "redundant": true,
      "echo": false,
      "sentence": "And can you confirm your full name again, Dana?"
    },
    {
      "turn_index": 8,
      "category": "payment_card",
      "sensitivity": "high",
      "scope": "out_of_scope",
      "redundant": false,
      "echo": true,
      "sentence": "One last thing, while I have you, can you read me the full card number and the security code?",
      "echo_turn_index": 10,
      "echo_sentence": "I have your card number as #################12, thank you."
    }
  ],
  "counts": {
    "requests": 5,
    "out_of_scope": 2,
    "redundant": 1,
    "echo": 1,
    "high_sensitivity": 1
  },
  "goal_scope_categories": [
    "full_name",
    "phone_number"
  ],
  "disclaimer": "Heuristic lexical audit against the goal file only. The goal file is the sole ground truth for scope; a category the goal omits may still be lawful to collect, and paraphrases outside the lexicon are missed. High-sensitivity tags are advisory, not a legal determination. Findings route to review."
}
```

## Analyze a call whose goal file lacks a field list

The goal file names no required fields, so every request's scope is
unverifiable and the verdict says so instead of guessing.

```bash
python3 skills/call-data-minimization-auditor/scripts/data_minimization_auditor.py analyze \
  --transcript skills/call-data-minimization-auditor/references/example-transcript-unverifiable.json \
  --goal-file skills/call-data-minimization-auditor/references/example-goal-unverifiable.txt
```

Output:

```json
{
  "call_id": "demo-minimization-002",
  "verdict": "GOAL_FILE_LACKS_FIELD_LIST",
  "requests": [
    {
      "turn_index": 1,
      "category": "full_name",
      "sensitivity": "standard",
      "scope": "unverifiable",
      "redundant": false,
      "echo": false,
      "sentence": "Can I have your full name, please?"
    },
    {
      "turn_index": 3,
      "category": "date_of_birth",
      "sensitivity": "standard",
      "scope": "unverifiable",
      "redundant": false,
      "echo": false,
      "sentence": "And can I have your date of birth to pull up the chart?"
    }
  ],
  "counts": {
    "requests": 2,
    "out_of_scope": 0,
    "redundant": 0,
    "echo": 0,
    "high_sensitivity": 0
  },
  "goal_scope_categories": [],
  "disclaimer": "Heuristic lexical audit against the goal file only. The goal file is the sole ground truth for scope; a category the goal omits may still be lawful to collect, and paraphrases outside the lexicon are missed. High-sensitivity tags are advisory, not a legal determination. Findings route to review."
}
```

## Craft a minimal-intake goal

```bash
python3 skills/call-data-minimization-auditor/scripts/data_minimization_auditor.py craft --scenario minimal-intake
```

```json
{
  "skill": "call-data-minimization-auditor",
  "scenario": "minimal-intake",
  "language": "en",
  "goal_template": "You are placing an appointment-intake call. Your goal requires an explicit required-fields list: the caller's full name and the appointment date. Ask for each of those once, plainly, and nothing else. If the caller offers information I do not need, I will politely decline: 'I don't need that information for this call.' I will confirm sensitive numbers by their last two digits only. Once the caller has given a piece of information, I will not ask for it again.",
  "checklist": [
    "explicit required-fields list",
    "polite refusal line",
    "masked-confirmation policy",
    "no-re-asking rule"
  ]
}
```

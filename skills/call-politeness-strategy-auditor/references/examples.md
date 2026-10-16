# Examples: call-politeness-strategy-auditor

All commands run from the skill root
(`skills/call-politeness-strategy-auditor`). Output below is real
CLI stdout, unedited.

## COURTEOUS - every request carries strategy markers

```bash
python3 scripts/politeness_strategy_auditor.py analyze \
  --call-result references/example-call-result.json
```

```json
{
  "skill": "call-politeness-strategy-auditor",
  "call_id": "demo-polite-001",
  "verdict": "COURTEOUS",
  "counts": {
    "requests": 3,
    "bald": 0,
    "question_requests": 3,
    "condescension_flags": 0
  },
  "requests": [
    {
      "sentence": "Could you confirm your date of birth, please?",
      "form": "question",
      "strategies": [
        "modal",
        "please"
      ],
      "grade": "SOFTENED",
      "turn_index": 0
    },
    {
      "sentence": "And could you spell your last name for me?",
      "form": "question",
      "strategies": [
        "modal"
      ],
      "grade": "SOFTENED",
      "turn_index": 2
    },
    {
      "sentence": "Just one more thing - would you mind confirming the delivery address?",
      "form": "question",
      "strategies": [
        "modal",
        "hedge",
        "counterfactual"
      ],
      "grade": "SOFTENED",
      "turn_index": 4
    }
  ],
  "advisories": [],
  "post_summary_present": true,
  "disclaimer": "Form audit, never content: a polite request for out-of-scope data still fails call-data-minimization-auditor, and politeness grading never sanitizes what is asked. Lexical strategy markers, not a cultural or sincerity judgment. Route findings to human review."
}
```

## BALD_REQUESTS_DETECTED - bare imperatives, zero redress

```bash
python3 scripts/politeness_strategy_auditor.py analyze \
  --call-result references/example-call-result-bald.json
```

```json
{
  "skill": "call-politeness-strategy-auditor",
  "call_id": "demo-polite-002",
  "verdict": "BALD_REQUESTS_DETECTED",
  "counts": {
    "requests": 4,
    "bald": 4,
    "question_requests": 0,
    "condescension_flags": 0
  },
  "requests": [
    {
      "sentence": "Give me your account number.",
      "form": "imperative",
      "strategies": [],
      "grade": "BALD",
      "turn_index": 0
    },
    {
      "sentence": "Spell your last name.",
      "form": "imperative",
      "strategies": [],
      "grade": "BALD",
      "turn_index": 0
    },
    {
      "sentence": "Read the card digits.",
      "form": "imperative",
      "strategies": [],
      "grade": "BALD",
      "turn_index": 0
    },
    {
      "sentence": "Repeat it after the tone.",
      "form": "imperative",
      "strategies": [],
      "grade": "BALD",
      "turn_index": 2
    }
  ],
  "advisories": [],
  "post_summary_present": true,
  "disclaimer": "Form audit, never content: a polite request for out-of-scope data still fails call-data-minimization-auditor, and politeness grading never sanitizes what is asked. Lexical strategy markers, not a cultural or sincerity judgment. Route findings to human review."
}
```

## MIXED - one bald request plus a condescension advisory

```bash
python3 scripts/politeness_strategy_auditor.py analyze \
  --call-result references/example-call-result-mixed.json
```

```json
{
  "skill": "call-politeness-strategy-auditor",
  "call_id": "demo-polite-003",
  "verdict": "MIXED",
  "counts": {
    "requests": 2,
    "bald": 1,
    "question_requests": 1,
    "condescension_flags": 1
  },
  "requests": [
    {
      "sentence": "Give me your membership number.",
      "form": "imperative",
      "strategies": [],
      "grade": "BALD",
      "turn_index": 0
    },
    {
      "sentence": "Could you confirm the mailing address when you have a moment?",
      "form": "question",
      "strategies": [
        "modal",
        "deference"
      ],
      "grade": "SOFTENED",
      "turn_index": 2
    }
  ],
  "advisories": [
    "condescension_turn: 2"
  ],
  "post_summary_present": true,
  "disclaimer": "Form audit, never content: a polite request for out-of-scope data still fails call-data-minimization-auditor, and politeness grading never sanitizes what is asked. Lexical strategy markers, not a cultural or sincerity judgment. Route findings to human review."
}
```

## NO_AGENT_REQUESTS - informational call, nothing to grade

```bash
python3 scripts/politeness_strategy_auditor.py analyze \
  --call-result references/example-call-result-no-requests.json
```

```json
{
  "skill": "call-politeness-strategy-auditor",
  "call_id": "demo-polite-004",
  "verdict": "NO_AGENT_REQUESTS",
  "counts": {
    "requests": 0,
    "bald": 0,
    "question_requests": 0,
    "condescension_flags": 0
  },
  "requests": [],
  "advisories": [],
  "post_summary_present": true,
  "disclaimer": "Form audit, never content: a polite request for out-of-scope data still fails call-data-minimization-auditor, and politeness grading never sanitizes what is asked. Lexical strategy markers, not a cultural or sincerity judgment. Route findings to human review."
}
```

## craft

```bash
python3 scripts/politeness_strategy_auditor.py craft
```

```text
GOAL: collect the required details from the callee.
REQUEST DISCIPLINE: make every request with a modal ("Could you..."), attach
"please" where natural, thank the caller after each compliance, and apologize
once for the interruption at the start. Never use bare imperatives ("Give me
...") - softened requests get the same data with less friction.
```

# Examples - call-guess-forcing-auditor

All commands run verbatim from the skill directory. Every output block
below is byte-real CLI output from a live run.

## 1. Craft an open-questioning goal

```bash
python3 scripts/guess_forcing_auditor.py craft --number +14155550168 --business-name "Harbor Inn" --task "confirm the Friday arrival time"
```

Output:

```json
{
  "goal_template": {
    "name": "open-questioning business call",
    "description": "Harbor Inn: confirm the Friday arrival time - with open-questioning protocol",
    "language": "en-US",
    "to": "+14155550168",
    "business_name": "Harbor Inn",
    "task": "confirm the Friday arrival time",
    "protocol": "If the person is unsure, accept 'not sure' as the answer of record. Offer to confirm by callback or message instead of pressing. Never ask for a best guess on facts the person cannot know. When a person volunteers an uncertain value, repeat it back with their qualifier and mark it tentative in the summary. Ask open questions (what works best for you) rather than pressing for specific values.",
    "safety": "Fictional testing only. This template does not authorize any real call."
  }
}
```

The `protocol` field drops into any plan_call goal so the agent knows,
before dialing, that "not sure" is a valid answer of record and that
best-guess invitations are forbidden. The same JSON ships as
`data/example-goal.json`.

## 2. Analyze - GUESS_PRESSURE_UNMITIGATED (demo-guess-001)

```bash
python3 scripts/guess_forcing_auditor.py analyze --call-result data/fixtures/demo-guess-001.json
```

Output:

```json
{
  "skill": "call-guess-forcing-auditor",
  "mode": "analyze",
  "call_id": "demo-guess-001",
  "verdict": "GUESS_PRESSURE_UNMITIGATED",
  "events": [
    {
      "type": "callee_uncertainty",
      "turn_index": 1,
      "sentence": "Hi, I'm not sure what time we'll arrive on Friday.",
      "detail": "callee expressed uncertainty"
    },
    {
      "type": "agent_pressure",
      "turn_index": 2,
      "sentence": "Just roughly, your best guess - what time should I put down?",
      "detail": "pressure cue: Just roughly"
    },
    {
      "type": "callee_yield",
      "turn_index": 3,
      "sentence": "Maybe 7?",
      "detail": "kind: hedged",
      "yield_value": "7"
    },
    {
      "type": "consolidation_as_fact",
      "turn_index": 4,
      "sentence": "Perfect, 7 p.m. it is - you're all set.",
      "detail": "hedged guess restated as firm"
    }
  ],
  "counts": {
    "uncertainty_events": 1,
    "pressure_events": 1,
    "yields": 1,
    "consolidations_as_fact": 1,
    "consolidations_hedge_preserved": 0,
    "shifts": 0
  },
  "summary_carries_value": null,
  "review_action": "rewrite the goal template: never press for guesses; repeat uncertain values back with their qualifier and mark them tentative",
  "notes": "Heuristic text-only analysis of elicitation pressure. Findings grade the conversation, not the callee's memory or honesty; every verdict routes to human review, never to automated conclusions about either party."
}
```

The callee said "I'm not sure", the agent pressed for a best guess, the
callee hedged "Maybe 7?", and the agent booked "Perfect, 7 p.m. it is -
you're all set." A record built from a forced guess is a fabricated
record - the review action says rewrite the goal template.

## 3. Analyze - GUESS_PRESSURE_MITIGATED (demo-guess-002)

```bash
python3 scripts/guess_forcing_auditor.py analyze --call-result data/fixtures/demo-guess-002.json
```

Output:

```json
{
  "skill": "call-guess-forcing-auditor",
  "mode": "analyze",
  "call_id": "demo-guess-002",
  "verdict": "GUESS_PRESSURE_MITIGATED",
  "events": [
    {
      "type": "callee_uncertainty",
      "turn_index": 1,
      "sentence": "Hi, I'm not sure what time we'll arrive on Friday.",
      "detail": "callee expressed uncertainty"
    },
    {
      "type": "agent_pressure",
      "turn_index": 2,
      "sentence": "Just roughly, your best guess - what time should I put down?",
      "detail": "pressure cue: Just roughly"
    },
    {
      "type": "callee_yield",
      "turn_index": 3,
      "sentence": "Maybe 7?",
      "detail": "kind: hedged",
      "yield_value": "7"
    },
    {
      "type": "consolidation_hedge_preserved",
      "turn_index": 4,
      "sentence": "Got it - around 7, I'll mark that as tentative and we can confirm tomorrow.",
      "detail": "qualifier kept next to the value"
    }
  ],
  "counts": {
    "uncertainty_events": 1,
    "pressure_events": 1,
    "yields": 1,
    "consolidations_as_fact": 0,
    "consolidations_hedge_preserved": 1,
    "shifts": 0
  },
  "summary_carries_value": null,
  "review_action": "none",
  "notes": "Heuristic text-only analysis of elicitation pressure. Findings grade the conversation, not the callee's memory or honesty; every verdict routes to human review, never to automated conclusions about either party."
}
```

Same pressure and yield as fixture 001, but the agent repeated the value
with its qualifier ("around 7"), marked it tentative, and scheduled a
confirmation - the passing grade for a call where a guess still slipped
out. (Fixture 004 and the PRESSURE_APPLIED_NO_YIELD verdict are covered
by the test suite and the verdicts table.)

## 4. Analyze - UNCERTAINTY_RESPECTED (demo-guess-003)

```bash
python3 scripts/guess_forcing_auditor.py analyze --call-result data/fixtures/demo-guess-003.json
```

Output:

```json
{
  "skill": "call-guess-forcing-auditor",
  "mode": "analyze",
  "call_id": "demo-guess-003",
  "verdict": "UNCERTAINTY_RESPECTED",
  "events": [
    {
      "type": "callee_uncertainty",
      "turn_index": 1,
      "sentence": "Hi, I'm not sure what time we'll arrive.",
      "detail": "callee expressed uncertainty"
    }
  ],
  "counts": {
    "uncertainty_events": 1,
    "pressure_events": 0,
    "yields": 0,
    "consolidations_as_fact": 0,
    "consolidations_hedge_preserved": 0,
    "shifts": 0
  },
  "summary_carries_value": null,
  "review_action": "none",
  "notes": "Heuristic text-only analysis of elicitation pressure. Findings grade the conversation, not the callee's memory or honesty; every verdict routes to human review, never to automated conclusions about either party."
}
```

The callee said "I'm not sure" and the agent offered to confirm by
message tomorrow instead of pressing - no pressure event fired, and the
call passes.

## 5. Analyze - NO_UNCERTAINTY_EXPRESSED (demo-guess-004)

```bash
python3 scripts/guess_forcing_auditor.py analyze --call-result data/fixtures/demo-guess-004.json
```

Output:

```json
{
  "skill": "call-guess-forcing-auditor",
  "mode": "analyze",
  "call_id": "demo-guess-004",
  "verdict": "NO_UNCERTAINTY_EXPRESSED",
  "events": [],
  "counts": {
    "uncertainty_events": 0,
    "pressure_events": 0,
    "yields": 0,
    "consolidations_as_fact": 0,
    "consolidations_hedge_preserved": 0,
    "shifts": 0
  },
  "summary_carries_value": null,
  "review_action": "none",
  "notes": "Heuristic text-only analysis of elicitation pressure. Findings grade the conversation, not the callee's memory or honesty; every verdict routes to human review, never to automated conclusions about either party."
}
```

The callee gave a concrete time up front ("We'll arrive at 7 p.m. on
Friday") - no uncertainty event fired, so there was nothing to press on
and nothing to grade.

## 6. Analyze - PRESSURE_APPLIED_NO_YIELD (demo-guess-005)

```bash
python3 scripts/guess_forcing_auditor.py analyze --call-result data/fixtures/demo-guess-005.json
```

Output:

```json
{
  "skill": "call-guess-forcing-auditor",
  "mode": "analyze",
  "call_id": "demo-guess-005",
  "verdict": "PRESSURE_APPLIED_NO_YIELD",
  "events": [
    {
      "type": "callee_uncertainty",
      "turn_index": 1,
      "sentence": "I'm not sure what time we'll arrive on Friday.",
      "detail": "callee expressed uncertainty"
    },
    {
      "type": "agent_pressure",
      "turn_index": 2,
      "sentence": "Just roughly, your best guess - what time should I put down?",
      "detail": "pressure cue: Just roughly"
    },
    {
      "type": "callee_uncertainty",
      "turn_index": 3,
      "sentence": "Honestly, no idea.",
      "detail": "callee expressed uncertainty"
    }
  ],
  "counts": {
    "uncertainty_events": 2,
    "pressure_events": 1,
    "yields": 0,
    "consolidations_as_fact": 0,
    "consolidations_hedge_preserved": 0,
    "shifts": 0
  },
  "summary_carries_value": null,
  "review_action": "remove guess-invitation phrasing from the goal template",
  "notes": "Heuristic text-only analysis of elicitation pressure. Findings grade the conversation, not the callee's memory or honesty; every verdict routes to human review, never to automated conclusions about either party."
}
```

The agent pressed ("Just roughly, your best guess - what time should I
put down?") after the callee said "I'm not sure". The callee's second
turn - "Honestly, no idea. Whatever works." - is a SECOND uncertainty
event, not a yield: "no idea" carries no number and "Whatever works."
names no time, so yields stays 0. Pressure fired and the callee never
produced a value: `PRESSURE_APPLIED_NO_YIELD`. The verdict matrix is
complete: GUESS_PRESSURE_UNMITIGATED, GUESS_PRESSURE_MITIGATED,
UNCERTAINTY_RESPECTED, NO_UNCERTAINTY_EXPRESSED, PRESSURE_APPLIED_NO_YIELD.

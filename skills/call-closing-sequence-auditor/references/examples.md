# Examples: call-closing-sequence-auditor

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: summary, arrangement, and a completed goodbye (WELL_FORMED)

Fixture: `references/example-transcript.json` - the agent confirms the
reservation with its key values, states the next step, asks for further
business, and only then both sides exchange farewells.

Command:

```bash
python3 skills/call-closing-sequence-auditor/scripts/closing_sequence_auditor.py analyze \
  --transcript skills/call-closing-sequence-auditor/references/example-transcript.json
```

Output:

```json
{
  "call_id": "call-close-001",
  "skill": "call-closing-sequence-auditor",
  "analysis_mode": "heuristic",
  "closing_assessment": "assessed",
  "reason": null,
  "checks": {
    "summary_present": true,
    "arrangement_present": true,
    "terminal_exchange_complete": true,
    "dangling_question": false,
    "post_closing_business": false,
    "abrupt_end": false
  },
  "verdict": "WELL_FORMED_CLOSING",
  "reasons": [],
  "recommended_action": {
    "action": "continue",
    "guidance": null
  },
  "disclaimer": "Sequence-shape heuristics, not a satisfaction measure. A call may legitimately end without a summary - the person can hang up mid-flow. DEFICIENT means review the ending, not that the call failed. English-only patterns."
}
```

## Example 2: the person's last question never got an answer (DEFICIENT)

Fixture: `references/example-transcript-dangling.json` - the summary is
fine, but no next step was arranged, no farewells were exchanged, and
the transcript ends on the callee's unanswered question.

Command:

```bash
python3 skills/call-closing-sequence-auditor/scripts/closing_sequence_auditor.py analyze \
  --transcript skills/call-closing-sequence-auditor/references/example-transcript-dangling.json
```

Output:

```json
{
  "call_id": "call-close-002",
  "skill": "call-closing-sequence-auditor",
  "analysis_mode": "heuristic",
  "closing_assessment": "assessed",
  "reason": null,
  "checks": {
    "summary_present": true,
    "arrangement_present": false,
    "terminal_exchange_complete": false,
    "dangling_question": true,
    "post_closing_business": false,
    "abrupt_end": false
  },
  "verdict": "DEFICIENT_CLOSING",
  "reasons": [
    "MISSING_ARRANGEMENT",
    "NO_TERMINAL_EXCHANGE",
    "DANGLING_QUESTION"
  ],
  "recommended_action": {
    "action": "review_call_ending",
    "guidance": "The closing window is incomplete: Missing arrangement, No terminal exchange, Dangling question. Decide whether the ending needs a follow-up touch."
  },
  "disclaimer": "Sequence-shape heuristics, not a satisfaction measure. A call may legitimately end without a summary - the person can hang up mid-flow. DEFICIENT means review the ending, not that the call failed. English-only patterns."
}
```

## Example 3: a polite ending with nothing restated (DEFICIENT)

Fixture: `references/example-transcript-nosummary.json` - the parking
question was answered and both sides said goodbye, but no outcome was
summarized and no next step was named.

Command:

```bash
python3 skills/call-closing-sequence-auditor/scripts/closing_sequence_auditor.py analyze \
  --transcript skills/call-closing-sequence-auditor/references/example-transcript-nosummary.json
```

Output:

```json
{
  "call_id": "call-close-003",
  "skill": "call-closing-sequence-auditor",
  "analysis_mode": "heuristic",
  "closing_assessment": "assessed",
  "reason": null,
  "checks": {
    "summary_present": false,
    "arrangement_present": false,
    "terminal_exchange_complete": true,
    "dangling_question": false,
    "post_closing_business": false,
    "abrupt_end": false
  },
  "verdict": "DEFICIENT_CLOSING",
  "reasons": [
    "MISSING_SUMMARY",
    "MISSING_ARRANGEMENT"
  ],
  "recommended_action": {
    "action": "review_call_ending",
    "guidance": "The closing window is incomplete: Missing summary, Missing arrangement. Decide whether the ending needs a follow-up touch."
  },
  "disclaimer": "Sequence-shape heuristics, not a satisfaction measure. A call may legitimately end without a summary - the person can hang up mid-flow. DEFICIENT means review the ending, not that the call failed. English-only patterns."
}
```

## Example 4: the call stops on an agent question (DEFICIENT)

Fixture: `references/example-transcript-abrupt.json` - the agent seeks
approval mid-sentence and the transcript ends there; no farewell ever
occurs, so `NO_TERMINAL_EXCHANGE` is suppressed in favor of
`ABRUPT_END`.

Command:

```bash
python3 skills/call-closing-sequence-auditor/scripts/closing_sequence_auditor.py analyze \
  --transcript skills/call-closing-sequence-auditor/references/example-transcript-abrupt.json
```

Output:

```json
{
  "call_id": "call-close-004",
  "skill": "call-closing-sequence-auditor",
  "analysis_mode": "heuristic",
  "closing_assessment": "assessed",
  "reason": null,
  "checks": {
    "summary_present": true,
    "arrangement_present": true,
    "terminal_exchange_complete": false,
    "dangling_question": false,
    "post_closing_business": false,
    "abrupt_end": true
  },
  "verdict": "DEFICIENT_CLOSING",
  "reasons": [
    "ABRUPT_END"
  ],
  "recommended_action": {
    "action": "review_call_ending",
    "guidance": "The closing window is incomplete: Abrupt end. Decide whether the ending needs a follow-up touch."
  },
  "disclaimer": "Sequence-shape heuristics, not a satisfaction measure. A call may legitimately end without a summary - the person can hang up mid-flow. DEFICIENT means review the ending, not that the call failed. English-only patterns."
}
```

## Example 5: craft the clean-closing goal

Command:

```bash
python3 skills/call-closing-sequence-auditor/scripts/closing_sequence_auditor.py craft \
  --scenario clean-closing
```

Output:

```json
{
  "skill": "call-closing-sequence-auditor",
  "mode": "craft",
  "scenario": "clean-closing",
  "language": "en",
  "goal": "Close every call cleanly. Restate the outcome with its key value: 'Just to confirm - table for four on Friday the 15th at 7 p.m.' State the next step: 'You'll receive a confirmation text shortly.' Ask 'Is there anything else I can help you with?' and WAIT for the answer. Only after the person has nothing further, say goodbye and end the call. Never introduce new business - dates, numbers, requests - after the goodbye.",
  "notes": [
    "Heuristic skill: this template is a starting point; adapt wording to the case.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

# Examples: call-correction-propagation-auditor

All commands run from the skill root
(`skills/call-correction-propagation-auditor`). Output below is real
CLI stdout, unedited.

## PROPAGATED - correction carried into the summary

```bash
python3 scripts/correction_propagation_auditor.py analyze --call-result references/example-call-result.json
```

```json
{
  "skill": "call-correction-propagation-auditor",
  "call_id": "demo-correct-001",
  "verdict": "PROPAGATED",
  "counts": {
    "correction_events": 1,
    "chains": 1,
    "stale": 0,
    "unconfirmed": 0
  },
  "corrections": [
    {
      "turn_index": 3,
      "marker": "sorry_i_said",
      "old_value": "tuesday",
      "new_value": "thursday",
      "kind": "weekday",
      "chain_index": 0,
      "confirmed": true
    }
  ],
  "summary_checks": [
    {
      "chain_index": 0,
      "final_value": "thursday",
      "final_in_summary": true,
      "stale_values_in_summary": [],
      "outcome": "propagated"
    }
  ],
  "advisories": [],
  "disclaimer": "Heuristic self-correction detection, not semantic repair analysis. A detected correction chain is lexical evidence the agent restated a value; STALE_VALUE_IN_SUMMARY means the superseded surface form appears in the summary while the corrected one does not. Callee revisions are provenance-grade's object; callee-initiated repair is call-repair-sequence-auditor's object. Route every finding to human review against the call record."
}
```

## STALE_VALUE_IN_SUMMARY - superseded value reached the summary

```bash
python3 scripts/correction_propagation_auditor.py analyze --call-result references/example-call-result-stale.json
```

```json
{
  "skill": "call-correction-propagation-auditor",
  "call_id": "demo-correct-002",
  "verdict": "STALE_VALUE_IN_SUMMARY",
  "counts": {
    "correction_events": 1,
    "chains": 1,
    "stale": 1,
    "unconfirmed": 0
  },
  "corrections": [
    {
      "turn_index": 3,
      "marker": "sorry_i_said",
      "old_value": "tuesday",
      "new_value": "thursday",
      "kind": "weekday",
      "chain_index": 0,
      "confirmed": true
    }
  ],
  "summary_checks": [
    {
      "chain_index": 0,
      "final_value": "thursday",
      "final_in_summary": false,
      "stale_values_in_summary": [
        "tuesday"
      ],
      "outcome": "stale"
    }
  ],
  "advisories": [],
  "disclaimer": "Heuristic self-correction detection, not semantic repair analysis. A detected correction chain is lexical evidence the agent restated a value; STALE_VALUE_IN_SUMMARY means the superseded surface form appears in the summary while the corrected one does not. Callee revisions are provenance-grade's object; callee-initiated repair is call-repair-sequence-auditor's object. Route every finding to human review against the call record."
}
```

Same transcript as the PROPAGATED fixture; only the summary differs -
it carries the pre-correction "Tuesday". The faithfulness auditor would
grade this summary SUPPORTED on "Tuesday" because it was genuinely
spoken; this skill catches the value the agent itself withdrew.

## NO_SELF_CORRECTIONS

```bash
python3 scripts/correction_propagation_auditor.py analyze --call-result references/example-call-result-none.json
```

```json
{
  "skill": "call-correction-propagation-auditor",
  "call_id": "demo-correct-003",
  "verdict": "NO_SELF_CORRECTIONS",
  "counts": {
    "correction_events": 0,
    "chains": 0,
    "stale": 0,
    "unconfirmed": 0
  },
  "corrections": [],
  "summary_checks": [],
  "advisories": [],
  "disclaimer": "Heuristic self-correction detection, not semantic repair analysis. A detected correction chain is lexical evidence the agent restated a value; STALE_VALUE_IN_SUMMARY means the superseded surface form appears in the summary while the corrected one does not. Callee revisions are provenance-grade's object; callee-initiated repair is call-repair-sequence-auditor's object. Route every finding to human review against the call record."
}
```

## CORRECTIONS_UNCONFIRMED - corrected value carried but never confirmed

```bash
python3 scripts/correction_propagation_auditor.py analyze --call-result references/example-call-result-unconfirmed.json
```

```json
{
  "skill": "call-correction-propagation-auditor",
  "call_id": "demo-correct-004",
  "verdict": "CORRECTIONS_UNCONFIRMED",
  "counts": {
    "correction_events": 1,
    "chains": 1,
    "stale": 0,
    "unconfirmed": 1
  },
  "corrections": [
    {
      "turn_index": 0,
      "marker": "meant",
      "old_value": "19:00",
      "new_value": "19:30",
      "kind": "clock",
      "chain_index": 0,
      "confirmed": false
    }
  ],
  "summary_checks": [
    {
      "chain_index": 0,
      "final_value": "19:30",
      "final_in_summary": true,
      "stale_values_in_summary": [],
      "outcome": "propagated"
    }
  ],
  "advisories": [],
  "disclaimer": "Heuristic self-correction detection, not semantic repair analysis. A detected correction chain is lexical evidence the agent restated a value; STALE_VALUE_IN_SUMMARY means the superseded surface form appears in the summary while the corrected one does not. Callee revisions are provenance-grade's object; callee-initiated repair is call-repair-sequence-auditor's object. Route every finding to human review against the call record."
}
```

## craft

```bash
python3 scripts/correction_propagation_auditor.py craft
```

```text
GOAL: collect or confirm the booking details with the callee.
CORRECTION DISCIPLINE: if you correct any detail mid-call (date, time,
amount, name, address), immediately (1) re-state the corrected value in
a full sentence, (2) ask the caller to confirm it, and (3) use only the
corrected value from then on. The end-of-call summary must state only
corrected values - never a value you superseded during the call.
```

A worked goal ships as `references/example-goal.txt`.

# Examples: call-temporal-anchor-auditor

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks). Analyze
commands run from the skill directory with `--called-at` set to the run
time so relative phrases resolve.

## Example 1: a fully anchored confirmation (FULLY_ANCHORED)

Fixture: `references/example-transcript.json` - the agent states
"Wednesday, October 14 at 2 p.m." and restates the same anchor.

Command:

```bash
cd skills/call-temporal-anchor-auditor
python3 scripts/call_temporal_anchor_auditor.py analyze \
  --call-result references/example-transcript.json \
  --called-at 2026-10-07T09:00:00-07:00
```

Output:

```json
{
  "call_id": "demo-temporal-001",
  "verdict": "FULLY_ANCHORED",
  "called_at_echo": "2026-10-07T09:00:00-07:00",
  "notes": [],
  "expressions": [
    {
      "turn_index": 2,
      "text": "October 14",
      "class": "absolute_date",
      "value": "oct 14",
      "resolved_date": "2026-10-14"
    },
    {
      "turn_index": 2,
      "text": "at 2 p.m",
      "class": "clock_absolute",
      "value": "14:00"
    },
    {
      "turn_index": 4,
      "text": "October 14",
      "class": "absolute_date",
      "value": "oct 14",
      "resolved_date": "2026-10-14"
    },
    {
      "turn_index": 4,
      "text": "at 2 p.m",
      "class": "clock_absolute",
      "value": "14:00"
    }
  ],
  "commitment_findings": [],
  "callee_time_mentions": 2,
  "conflicts": [],
  "counts": {
    "absolute_date": 2,
    "clock_absolute": 2
  },
  "disclaimer": "Heuristic temporal-lexicon analysis. AMBIGUOUS flags are advisory; relative expressions need the call timestamp to resolve, and a missing anchor is not proof the callee misheard anything. Findings route to verification against the record."
}
```

Note the evidence text renders "at 2 p.m" (trailing dot trimmed) while the
canonical value stays "14:00" - judge anchoring by values.

## Example 2: a weekday-date calendar conflict (INTERNAL_DATE_CONFLICT)

Fixture: `references/example-transcript-conflict.json` - the agent says
"Tuesday, October 14" (a Wednesday in 2026) and a meridiem-less "at 2".

Command:

```bash
cd skills/call-temporal-anchor-auditor
python3 scripts/call_temporal_anchor_auditor.py analyze \
  --call-result references/example-transcript-conflict.json \
  --called-at 2026-10-07T09:00:00-07:00
```

Output:

```json
{
  "call_id": "demo-temporal-002",
  "verdict": "INTERNAL_DATE_CONFLICT",
  "called_at_echo": "2026-10-07T09:00:00-07:00",
  "notes": [],
  "expressions": [
    {
      "turn_index": 2,
      "text": "October 14",
      "class": "absolute_date",
      "value": "oct 14",
      "resolved_date": "2026-10-14"
    },
    {
      "turn_index": 2,
      "text": "at 2",
      "class": "clock_ambiguous",
      "value": "2"
    }
  ],
  "commitment_findings": [],
  "callee_time_mentions": 1,
  "conflicts": [
    {
      "type": "INTERNAL_DATE_CONFLICT",
      "turn_index": 2,
      "stated_weekday": "tuesday",
      "date": "2026-10-14",
      "actual_weekday": "wednesday",
      "text": "It is Tuesday, October 14 at 2. Please be home."
    }
  ],
  "counts": {
    "absolute_date": 1,
    "clock_ambiguous": 1
  },
  "disclaimer": "Heuristic temporal-lexicon analysis. AMBIGUOUS flags are advisory; relative expressions need the call timestamp to resolve, and a missing anchor is not proof the callee misheard anything. Findings route to verification against the record."
}
```

## Example 3: a relative-only commitment (RELATIVE_ONLY_COMMITMENTS)

Fixture: `references/example-transcript-relative.json` - the agent commits
with "tomorrow evening" and "next week", never a clock time.

Command:

```bash
cd skills/call-temporal-anchor-auditor
python3 scripts/call_temporal_anchor_auditor.py analyze \
  --call-result references/example-transcript-relative.json \
  --called-at 2026-10-07T09:00:00-07:00
```

Output:

```json
{
  "call_id": "demo-temporal-003",
  "verdict": "RELATIVE_ONLY_COMMITMENTS",
  "called_at_echo": "2026-10-07T09:00:00-07:00",
  "notes": [],
  "expressions": [
    {
      "turn_index": 2,
      "text": "tomorrow evening",
      "class": "band"
    },
    {
      "turn_index": 2,
      "text": "tomorrow",
      "class": "relative_resolved",
      "value": "2026-10-08"
    },
    {
      "turn_index": 4,
      "text": "next week",
      "class": "ambiguous",
      "reason": "week-range reference without a concrete day"
    }
  ],
  "commitment_findings": [
    {
      "turn_index": 2,
      "expression": "tomorrow evening",
      "type": "RELATIVE_ONLY_COMMITMENT",
      "suggested": "weekday, month day, at H p.m."
    }
  ],
  "callee_time_mentions": 0,
  "conflicts": [],
  "counts": {
    "band": 1,
    "relative_resolved": 1,
    "ambiguous": 1
  },
  "disclaimer": "Heuristic temporal-lexicon analysis. AMBIGUOUS flags are advisory; relative expressions need the call timestamp to resolve, and a missing anchor is not proof the callee misheard anything. Findings route to verification against the record."
}
```

## Craft an absolute-time goal

Command:

```bash
cd skills/call-temporal-anchor-auditor
python3 scripts/call_temporal_anchor_auditor.py craft \
  --task "confirm the catering pickup" \
  --date "Wednesday, October 14" --time "2 p.m."
```

Output:

```text
GOAL: confirm the catering pickup
TIME DISCIPLINE: state every commitment as weekday + calendar date + clock time + meridiem
- example: "Wednesday, October 14, at 2 p.m."
- read the full anchor back once and only once
- never use bare "next <weekday>" or "tomorrow" without the calendar date
- if the person proposes a time, confirm it back with both date and clock time
SLOT: Wednesday, October 14 at 2 p.m.
```

## WITHOUT --called-at

The same relative fixture analyzed without the flag: relatives grade
`unresolvable_without_call_time` and pair checks are skipped with a note.

Command:

```bash
cd skills/call-temporal-anchor-auditor
python3 scripts/call_temporal_anchor_auditor.py analyze \
  --call-result references/example-transcript-relative.json
```

Output:

```json
{
  "call_id": "demo-temporal-003",
  "verdict": "RELATIVE_ONLY_COMMITMENTS",
  "called_at_echo": null,
  "notes": [
    "date-weekday pair checks skipped: no --called-at timestamp, so stated dates have no reference year"
  ],
  "expressions": [
    {
      "turn_index": 2,
      "text": "tomorrow evening",
      "class": "band"
    },
    {
      "turn_index": 2,
      "text": "tomorrow",
      "class": "unresolvable_without_call_time"
    },
    {
      "turn_index": 4,
      "text": "next week",
      "class": "unresolvable_without_call_time"
    }
  ],
  "commitment_findings": [
    {
      "turn_index": 2,
      "expression": "tomorrow evening",
      "type": "RELATIVE_ONLY_COMMITMENT",
      "suggested": "weekday, month day, at H p.m."
    }
  ],
  "callee_time_mentions": 0,
  "conflicts": [],
  "counts": {
    "band": 1,
    "unresolvable_without_call_time": 2
  },
  "disclaimer": "Heuristic temporal-lexicon analysis. AMBIGUOUS flags are advisory; relative expressions need the call timestamp to resolve, and a missing anchor is not proof the callee misheard anything. Findings route to verification against the record."
}
```

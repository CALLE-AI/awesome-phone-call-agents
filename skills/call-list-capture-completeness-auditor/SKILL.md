---
name: call-list-capture-completeness-auditor
description: Offline experimental transcript auditor that extracts the item lists a callee enumerated during a CALL-E call and grades the agent readback ALL_ITEMS_CAPTURED, ITEMS_DROPPED, ITEMS_ADDED, or BOTH_DROPPED_AND_ADDED, plus a readback-disciplined goal crafter; not an order manager, a proof of what was promised, or authorization to act.
license: MIT
---

# call-list-capture-completeness-auditor

> **When a caller enumerates "a crib, late checkout, and a high floor",
> the agent's confirmation is a promise about that exact set. One item
> silently dropped - or one item invented - is the failure mode this
> auditor exists to catch.**

This skill reads a finished call transcript, extracts the item lists the
CALLEE enumerated (comma / "and" / "plus" chunked noun phrases), and
grades the AGENT's readback: did it capture every item, and did it add
nothing the caller never said? Twin craft mode embeds a
readback-disciplined protocol into the goal before the call is placed.

## Why This Skill Exists

- Liu et al., "Lost in the Middle" (TACL 2024, arXiv:2307.03172):
  retrieval degrades for mid-context information - so the readback must
  be audited against the FULL enumerated set, not just the most recent
  items.
- Laban et al., "Summary of a Haystack" / SummHay (EMNLP 2024 main,
  arXiv:2407.01370): even strong systems drop insights when condensing
  spread information - dropped-item detection is a real failure surface.
- Modarressi et al., "NoLiMa" (ICML 2025, arXiv:2502.05167): degradation
  is worst beyond literal matching - so item matching here uses
  paraphrase-tolerant token overlap, not exact strings.
- FAA Aeronautical Information Manual para 4-4-7 (ATC
  clearance/instruction readback): aviation institutionalized readback
  as mutual verification against misheard or incorrect items - the
  craft protocol transplants that discipline to phone agents.

## When To Use

- after any CALL-E call where the callee enumerated requests, order
  lines, or change items, as a QA gate on the confirmation
- when a post_summary sounds like it merged or invented requests
- before placing booking/order calls, to craft a readback-disciplined
  goal template
- in CI over fixture corpora, to catch goal templates whose
  confirmation script drops or invents items

## Modes

### Analyze a finished call

```bash
python3 scripts/list_capture_completeness_auditor.py analyze \
  --call-result path/to/call-result.json
```

Accepts the real `get_call_run` result shape
(`{status, result: {transcript}}`), a bare `{transcript: [...]}` dict,
or a flat turn list. Emits the report described under Input/Output.

### Craft a readback-disciplined goal

```bash
python3 scripts/list_capture_completeness_auditor.py craft \
  --number +14155550149 --business-name "Harbor Grill" \
  --task "confirm the reservation requests"
```

`--number` must be a reserved test number matching
`+1[0-9]{3}55501[0-9]{2}`. Optional: `--language` (default `en-US`).
Emits a `goal_template` for plan_call whose `protocol` field instructs
the agent to repeat the full list back item by item in order, ask "Is
that everything?" before closing, never add unstated items, ask
targeted questions about unclear items, and write the final list into
the summary exactly as confirmed.

## Verdicts

| Verdict | Trigger | review_action |
|---|---|---|
| `BOTH_DROPPED_AND_ADDED` | at least one callee item never captured by the agent AND at least one invented item in a confirmation sentence | `rework the goal template readback: capture every item and drop invented ones` |
| `ITEMS_DROPPED` | at least one callee item never matched in any later agent turn | `add item-by-item readback to the goal template` |
| `ITEMS_ADDED` | a confirmation sentence contains an item matching nothing the callee listed or the agent stated earlier | `remove unverifiable items from the confirmation script` |
| `ALL_ITEMS_CAPTURED` | every callee item captured and at least one agent readback/confirmation sentence exists | `none` |
| `NO_READBACK_DETECTED` | a list was exchanged but no agent readback/confirmation sentence exists | `add a closing readback step to the goal template` |
| `NO_LIST_EXCHANGED` | no callee enumeration detected | `none` |

## Quick Start

Both commands run verbatim from the skill directory:

```bash
python3 scripts/list_capture_completeness_auditor.py craft \
  --number +14155550149 --business-name "Harbor Grill" \
  --task "confirm the reservation requests"
```

```bash
python3 scripts/list_capture_completeness_auditor.py analyze \
  --call-result data/fixtures/demo-list-002.json
```

The analyze command prints `verdict: ITEMS_DROPPED` for that fixture -
the callee listed a crib, late checkout, and a high floor, and the
readback captured only the first two. Full walkthroughs:
[references/examples.md](references/examples.md).

## Input / Output

Input: a JSON file that is either the wrapped `get_call_run` shape

```json
{"status": "COMPLETED", "result": {"transcript": [{"role": "...", "text": "..."}]}}
```

or a bare dict with a `transcript` key, or a flat list of
`{"role", "text"}` turns (`speaker` is accepted as a role alias).
Callee-side roles: `callee`, `customer`, `called_party`, `recipient`,
`human`. Agent-side: `agent`, `assistant`, `ai`, `bot`, `caller`.
Typographic apostrophes are normalized before matching; digit runs of
7+ are masked in output.

Output report keys: `skill`, `mode`, `call_id` (masked), `verdict`,
`lists` (each with per-item `captured` flag and quantity `note`),
`dropped_items`, `added_items`, `counts`
(`lists_detected`, `items_total`, `items_captured`, `items_dropped`,
`items_added`), `review_action`, `notes`.

## Limitations

- Chunking is a heuristic: commas and "and"/"plus" in natural speech do
  not always separate items, so item boundaries can be mis-split.
- Detection is English-only.
- The token-overlap match threshold (0.5) is a policy choice, not a
  validated parameter.
- An item is a noun phrase; quantities ("two large pizzas") are tracked
  as notes on the item, not as separate count checks.
- Negated chunks are treated as WITHDRAWALS only when they reference an
  item already in the active list ("no late checkout" after late
  checkout was requested removes that item); a first-mention negation
  ("no onions") is an item. This is a heuristic; ambiguous corrections
  should be human-reviewed (the report already exposes per-list items
  with turn indices).
- `call-closing-sequence-auditor` audits that a summary EXISTS at the
  close; this skill audits the item SET inside that summary.
- `exact-ref` gates identifier strings; this skill audits enumerated
  noun-phrase items, not reference codes.
- `call-summarizer` generates summaries; this skill audits them and
  never writes one.

## Testing

```bash
python3 -m pytest skills/call-list-capture-completeness-auditor/tests/ -v
python3 skills/call-list-capture-completeness-auditor/tests/test_list_capture_completeness_auditor.py
```

Both the pytest run and the standalone runner must pass with zero
failures.

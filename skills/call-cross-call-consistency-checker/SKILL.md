---
name: call-cross-call-consistency-checker
description: Offline experimental CALL-E helper that compares amounts, dates, and times stated by the agent across two finished calls to the same destination and grades each fact kind CONSISTENT, CONTRADICTED, or ONLY_STATED, plus a consistency-guarded goal template. It is not proof either call lied, a record of truth, or authorization for another call.
license: MIT
---

# call-cross-call-consistency-checker

> **Call someone twice and say two different things, and you were never
> really trusted the first time.**

Every other skill in this repository analyzes one call. This one analyzes
the space BETWEEN two calls to the same person: did the organization tell
them the same price, the same date, the same time it told them before?
Contradictions across calls are how campaigns lose people - each new call
quietly rewrites reality, and the person on the line is the only one who
notices.

## When To Use

- when a destination has received two or more calls and any result from
  the latest one will be written somewhere
- before drafting the NEXT call to a person whose earlier call had
  disputed or confusing values
- to generate a consistency-guarded goal for the follow-up plan_call

## When Not To Use

- to decide which call's value is true; the record (or a human with it)
  decides - this skill only routes to verification
- on calls to different destinations; comparing unrelated people's facts
  is meaningless
- as a memory system; it compares two transcripts you hand it, it stores
  nothing
- during a call; strictly post-call analysis plus pre-call goal crafting

## Workflow

### Compare two finished calls

```bash
python3 scripts/cross_call_consistency_checker.py analyze \
  --transcript-a path/to/call-a.json --transcript-b path/to/call-b.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat fixture shape used by sibling skills. Emits a card:

- `comparisons[]` per fact kind (`amount` / `date` / `time`):
  - `CONSISTENT` with the shared values when the calls overlap
  - `CONTRADICTED` when both calls state the kind and share no value
  - `ONLY_STATED` when just one call mentions the kind
- Only AGENT turns are extracted: the organization's statements must stay
  consistent; the callee mentioning a different value is a correction,
  not a record
- Legitimate reschedules do not self-contradict: "we moved you from the
  12th to the 15th" shares a value with a later call that says "the 15th"
- `verdict`: `CONTRADICTIONS_FOUND` / `CONSISTENT` / `NOTHING_TO_COMPARE`,
  plus `unclear` paths for empty or agent-less inputs
- Values are normalized ($45 = "45 dollars"; Tuesday the 15th = weekday +
  ordinal; 2 p.m. = 1400) and masked in output

### Craft the consistency-guarded goal

```bash
python3 scripts/cross_call_consistency_checker.py craft --scenario consistency-guarded-callback
```

Emits the plan_call inputs JSON whose goal makes the agent state values
with their source, acknowledge discrepancies instead of silently picking
a side, and never close a call with two unreconciled values.

## Scientific Foundation

| Research | Relevance |
|---|---|
| In Prospect and Retrospect: Reflective Memory Management for Long-term Personalized Dialogue Agents (Tan et al., ACL 2025, arXiv 2502.00299) | Long-term dialogue agents must keep personalized facts stable across sessions; our cross-call comparison is the transcript-side audit of exactly that property |
| Truth-Maintained Memory Agent: Proactive Quality Control for Reliable Long-Context Dialogue (Phadke, Guo, Koch et al., NeurIPS 2025 Workshop on Socially Responsible and Trustworthy Foundation Models, OpenReview) | Write-time quality control against false and contradictory memory; our CONTRADICTED routing is the call-records analogue |

Citation notes recorded during verification: the RMM paper's full title
begins "In Prospect and Retrospect:"; the TMMA paper is a NeurIPS 2025
WORKSHOP paper (not main conference), stated as such. This skill compares
two transcripts lexically and labels every output
`analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-state-reconciler` reconciles platform signals (status,
  task_completed, confidence) within one call; this skill reconciles
  human-readable facts across two calls.
- `adherence-memory-callback` remembers callers to make its own calls
  smarter; this skill audits any two transcripts for organizational
  consistency and stores nothing.
- `call-sycophancy-guard` catches the agent folding within a call; this
  skill catches the organization drifting between calls.

---
name: call-sycophancy-guard
description: Offline experimental CALL-E transcript helper that detects pushback against goal-grounded facts and classifies the agent's response (HOLDS, CAPITULATES, VERIFIES, UNADDRESSED), flags capitulated values that tainted the final confirmation, and crafts anti-capitulation goals. It is not a measure of the agent's intent, proof the callee was wrong, or authorization to act on the call's outcome.
license: MIT
---

# call-sycophancy-guard

> **An agent that agrees with everything confirms nothing.**

Language models are demonstrably sycophantic: trained on human feedback,
they affirm users far more often than humans do, and that behavior survives
into deployed assistants. On a phone call this has a specific cost: the
callee pushes back on a fact - "no, it's $50" - and the agent folds, not
because it saw evidence, but because agreeing is polite. The closing
confirmation then repeats the adopted value, and whatever parses that
outcome writes a fact nobody established. This skill catches exactly that
sequence.

## When To Use

- after any CALL-E call whose result contains amounts, dates, or times the
  callee disputed, and before the outcome is written anywhere
- with the goal text (or plan JSON) the call was built from, so ground
  facts can be extracted and checked against adopted values
- before placing a fact-bearing call, to craft a goal that holds facts
  without being rude

## When Not To Use

- to prove the callee was wrong: a capitulation is an unverified stance
  switch, and the callee holding a paper invoice may well be right; the
  card routes to verification, never to reversal
- to detect emotional pressure or hostility; use `call-fraud-shield` for
  scam patterns and `call-emotional-contagion-monitor` for affect
- during a call; this is strictly post-call analysis plus pre-call goal
  crafting, because CALL-E exposes transcripts, not live audio

## Workflow

### Audit a finished call

```bash
python3 scripts/sycophancy_guard.py analyze --transcript path/to/call-result.json \
  [--goal-file path/to/goal.txt]
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. The goal file is plain
text or a JSON with a `goal` field. Emits a card:

- `goal_facts`: amounts, dates, times extracted from the goal text
- `pushback_events[]`: turn index, masked span, the responding agent turn,
  and its `stance`:
  - `HOLDS` - restates the record ("our records show $45")
  - `CAPITULATES` - adopts the contradicting value ("you're right, it is
    $50") without verifiable evidence
  - `VERIFIES` - defers to an independent channel (statement number,
    callback colleague, transfer)
  - `UNADDRESSED` - pivots away
- `outcome_taint`: true when a capitulated value (a digit absent from the
  goal facts) reappears in a closing confirmation turn
- `verdict`: `CLEAN` / `PRESSURE_TAINTED` / `UNCERTAIN` (no goal file, or
  pushback the agent never visibly answered)
- `fields_to_verify_via_second_channel` and the matching recommended action

### Craft the anti-capitulation goal

```bash
python3 scripts/sycophancy_guard.py craft --scenario fact-bearing-call
```

Emits the plan_call inputs JSON whose goal instructs the agent to hold
stated facts, offer independent verification, adopt a caller's value only
on verifiable information, and record both values when disagreement
survives to the end.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Towards Understanding Sycophancy in Language Models (Sharma et al., ICLR 2024, arXiv 2310.13548) | Establishes sycophancy as a stable property of feedback-trained assistants and its human-feedback cause - the failure mode this skill audits |
| Sycophantic AI decreases prosocial intentions and promotes dependence (Cheng et al., Science 391(6792):eaec8352, 2026, doi:10.1126/science.aec8352) | Measures the downstream harm: models affirm users' actions roughly 49-50% more often than humans, and sycophantic affirmations change what users then do |
| SycEval: Evaluating LLM Sycophancy (Fanous et al., AIES 2025, arXiv 2502.08177) | Multi-turn sycophancy measurement; its progressive-opinion-shift framing informs this skill's pushback-then-stance sequence over a call |

Citation notes recorded during verification: the Cheng et al. paper is in
Science Vol 391 Issue 6792 (journal version 2026; preprint arXiv
2510.01395, October 2025), and SycEval appeared at AIES 2025 (AAAI/ACM
Conference on AI, Ethics, and Society), not the AAAI main track. This
skill detects overt stance switches in text only; it has no access to the
agent's internals and labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-emotional-contagion-monitor` tracks affect transferring between
  speakers; this skill tracks epistemic stance - what the agent claims is
  true - under social pressure.
- `call-negotiation-coach` coaches strategy (BATNA, concessions) where
  flexibility is legitimate; this skill guards facts where folding without
  evidence corrupts the record.
- `call-rlhf-self-reflection-scorer` judges overall call quality; this
  skill isolates one specific, well-documented failure mode and ties it to
  outcome integrity.
- `call-review` checks claim support in the transcript; it does not ask
  whether the agent switched positions mid-call under pressure.

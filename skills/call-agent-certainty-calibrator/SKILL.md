---
name: call-agent-certainty-calibrator
description: Offline experimental CALL-E transcript helper that flags agent statements of specific values absent from the goal facts and callee turns (over-assertion) and goal facts spoken with hedges but no source attribution (over-hedging), plus a three-tier calibrated-wording goal template. It is not proof the agent invented anything, a measure of internal confidence, or authorization to act.
license: MIT
---

# call-agent-certainty-calibrator

> **An agent that invents specifics is worse than one that says 'I don't
> know'. An agent that hedges its own record is worse than useless.**

Language models can express calibrated confidence in words - and, left
unchecked, they drift both ways: asserting specifics nobody gave them
("free delivery on Friday!") and softening facts they were told to state
("I think it might be $45?"). On a phone call both failures are audible,
and both end up in the outcome. This skill grades the agent's stated
values against the goal it was given.

## When To Use

- after any fact-bearing CALL-E call, together with the goal text (or
  plan JSON) the call was built from
- when an outcome contains a value nobody remembers putting in the goal
- before placing calls, to craft wording that speaks record facts with
  authority and admits gaps honestly

## When Not To Use

- without the goal file; calibration is graded against the goal's facts
  and the CLI requires it
- to prove the agent fabricated a value; an OVER-ASSERTED value may be
  true and simply missing from the goal text - the card routes to
  verification, always
- on the callee's certainty; `provenance-grade` grades how the callee
  knew what they said
- during a call; strictly post-call analysis plus pre-call goal crafting

## Workflow

### Audit a finished call

```bash
python3 scripts/agent_certainty_calibrator.py analyze \
  --transcript path/to/call-result.json --goal-file path/to/goal.txt
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat fixture shape used by sibling skill fixtures; the goal file is
plain text or a JSON with a `goal` field. Emits a card:

- `goal_facts`: amounts, dates, times extracted from the goal text
- `over_assertions[]`: agent-stated values in neither the goal facts nor
  any callee turn - unsourced specifics
- `over_hedges[]`: goal facts spoken in a sentence with hedge words
  ("i think", "might be", "around", ...) and no source marker
- `calibrated_statements`: goal facts stated plainly or attributed
  ("our records show...") - source attribution overrides a hedge
- `verdict`: `CALIBRATED` / `OVERASSERTIVE` / `OVERHEDGED` / `MIXED`,
  plus `unclear` paths (empty transcript, no agent turns, goal without
  extractable facts)

Values a CALLEE introduced and the agent merely confirmed are never
over-assertions: repeating the person's own value back is confirmation,
not invention.

### Craft the calibrated goal

```bash
python3 scripts/agent_certainty_calibrator.py craft --scenario calibrated-fact-stating
```

Emits the plan_call inputs JSON whose goal implements three tiers of
verbalized confidence: record facts stated with attribution, estimates
labeled as estimates, and gaps admitted exactly.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Teaching Models to Express Their Uncertainty in Words (Lin, Hilton, Evans, TMLR 2022, arXiv 2205.14334) | Established verbalized confidence: models can and should express calibrated uncertainty in language - our three-tier wording operationalizes it for calls |
| Can LLMs Express Their Uncertainty? An Empirical Evaluation of Confidence Elicitation in LLMs (Xiong et al., ICLR 2024, arXiv 2306.13063) | Empirical demonstration that verbalized confidence is often miscalibrated - the failure this skill audits on the transcript axis |

Citation notes recorded during verification: Lin et al. appeared in TMLR
2022 (arXiv 2205.14334); Xiong et al. at ICLR 2024 (arXiv 2306.13063).
This skill compares lexical value statements only, has no access to model
internals, and labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-sycophancy-guard` catches the agent folding under the person's
  pushback; this skill catches unsolicited drift - invention and
  groundless hedging with nobody pushing.
- `provenance-grade` grades the callee's epistemic state; this skill
  grades the agent's stated certainty against the goal record.
- `call-cross-call-consistency-checker` compares the organization across
  calls; this skill compares the agent against its own instructions
  within one call.

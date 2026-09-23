---
name: call-disfluency-stress-profiler
description: Offline heuristic CALL-E transcript skill that measures filled-pause, self-repair, repetition, and hesitation-opener rates per speaker side to detect callee stress and agent knowledge-gap hesitancy, then emits a reassurance-paced follow-up call goal. It is not a clinical stress assessment, a proof of speaker intent, or authorization to act automatically.
license: MIT
---

# call-disfluency-stress-profiler

> **A contact who says "uh... I mean... well..." three times per sentence
> is not fine. An agent that stumbles on every pricing question needs a
> better script.**

Spoken conversation carries signals that plain transcripts still preserve:
disfluency. When a callee is stressed, confused, or overwhelmed, their
filled-pause rate (`uh`, `um`, `er`) and self-repair frequency (`I mean`,
`actually`, word repetitions) spike measurably above baseline. When an agent
encounters questions outside its prepared knowledge, the same markers appear
in its turns.

This skill reads the finished `get_call_run` transcript, computes per-side
disfluency rates, and flags `CALLEE_STRESSED` or `AGENT_HESITANT` when rates
cross calibrated thresholds. It then offers a reassurance-paced follow-up
call goal or a script-review recommendation.

## When To Use

- after any CALL-E call where the contact seemed distressed or uncertain
- as part of a QA pipeline to detect agent knowledge gaps at scale
- in healthcare, collections, or support workflows where caller distress
  carries legal or ethical weight
- to identify topics that consistently cause agent hesitancy (→ update scripts)

## When Not To Use

- as a clinical or psychological stress assessment
- during a call; strictly post-call analysis plus pre-call goal crafting
- as the sole basis for medical or legal decisions
- on languages other than English; the lexicon is English-only

## Workflow

### Audit a finished call

```bash
python3 scripts/disfluency_stress_profiler.py analyze \
  --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape or the flat fixture shape. Emits
a disfluency card:

- `agent_profile` / `callee_profile`: per-side stats including `total_words`,
  `total_markers`, `disfluency_rate`, and `per_turn_counts`
- `flags[]`: `CALLEE_STRESSED` and/or `AGENT_HESITANT` when rates exceed
  their respective thresholds
- `verdict`: `NORMAL` / `CALLEE_STRESSED` / `AGENT_HESITANT` / `BOTH_STRESSED`,
  plus `unclear` paths
- `recommended_action`: one of `no_action_required`, `reassurance_followup`,
  `review_agent_script`, or `reassurance_followup_and_script_review`
- `disclaimer`: heuristic advisory disclaimer on every card

#### Thresholds (defaults)

| Side | Threshold | Flag triggered |
|---|---|---|
| Callee | 8% disfluency rate | `CALLEE_STRESSED` |
| Agent | 6% disfluency rate | `AGENT_HESITANT` |

#### Disfluency markers detected

| Category | Examples |
|---|---|
| Filled pauses | `uh`, `um`, `er`, `eh`, `ah`, `hmm` |
| Self-repairs | `I mean`, `actually`, `no wait`, `to rephrase` |
| Repetitions | `I I`, `the the`, `we we` |
| Hesitation openers | `well, `, `so, `, `you know, ` at clause start |

### Craft the reassurance follow-up goal

```bash
python3 scripts/disfluency_stress_profiler.py craft --scenario reassurance-followup
```

Emits the `plan_call` inputs JSON whose `goal` instructs the next call to
adopt a calm, unhurried pace, pause after each question, acknowledge concerns
explicitly, and ask one question per turn.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Shriberg, E. — *Preliminaries to a Theory of Speech Disfluencies* (PhD Thesis, UC Berkeley, 1994) | Gold-standard taxonomy for filled pauses, repetitions, and repairs in spoken dialogue; direct source for the marker categories in this skill |
| Levelt, W.J.M. — *Monitoring and Self-Repair in Speech* (Cognition, Vol. 14, 1983, doi:10.1016/0010-0277(83)90026-4) | Theory of self-repair: speakers monitor their own speech and repair when cognitive load is high; repair rate correlates with stress and difficulty |
| Kumar et al. — *Mind the Pause: Disfluency-Aware Objective Tuning for Multilingual Speech Correction with LLMs* (ACL 2026, arXiv:2605.12242) | Confirms that disfluency detection from text transcripts is technically feasible with high accuracy; provides methodology basis for lexical marker detection |
| Hough et al. — *"Mm, Wat?" Detecting Other-Initiated Repair Requests in Spoken Dialogue* (EMNLP 2025) | Validates that repair sequences are detectable from transcript text; shows correlation between disfluency markers and conversational breakdown |
| CALL-E Official Documentation — *Transcript Structure and get_call_run Result Schema* (docs.heycall-e.com) | Defines the exact JSON shapes this skill parses: `transcript[].speaker`, `transcript[].text`, and the nested `result` wrapper |

This skill implements a lexical/regex heuristic against the defined marker
taxonomy. It does not use model internals and labels every output
`analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-verbal-irony-detector` detects semantic incongruence (sarcasm/irony);
  this skill measures prosodic-cognitive load signals visible in text.
- `call-semantic-barge-in-analyzer` measures interruption patterns; this skill
  measures hesitancy within un-interrupted turns.
- `call-agent-certainty-calibrator` grades agent fact-statement accuracy; this
  skill grades conversational fluency and stress level on both sides.

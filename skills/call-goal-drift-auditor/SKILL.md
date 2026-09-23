---
name: call-goal-drift-auditor
description: Offline heuristic CALL-E transcript skill that compares the original call goal against the agent's actual turns to measure on-topic ratio, detect off-topic spans, and determine whether the goal was achieved in the closing — then emits a tighter, bounded goal for the next plan_call. It is not a compliance ruling, a semantic understanding system, or authorization to act automatically.
license: MIT
---

# call-goal-drift-auditor

> **An agent told to confirm an appointment that ends up selling whitening
> packages has drifted. Nobody noticed. Until now.**

Every CALL-E call starts with a `goal`. But calls are dynamic: a curious
callee, an ambitious agent script, or a distraction tangent can pull the
conversation far from the stated objective. Without post-call auditing,
nobody knows the goal was never really achieved — or that three agent turns
were spent on topics that were explicitly out of scope.

This skill reads the finished transcript alongside the original goal text,
extracts content keywords, measures per-turn on-topic ratio, detects
off-topic spans, and reports whether the goal appears achieved in the
closing confirmation. It also generates a tighter, bounded goal with
explicit scope-limiting instructions for the next call.

## When To Use

- after any CALL-E call where scope discipline matters
- when a call goal is narrow and violations are measurable
  (appointment confirmation, payment verification, consent capture)
- as part of a QA pipeline to detect systematic agent scope creep
- before replaying a failed or incomplete call with tighter instructions

## When Not To Use

- without a goal file; drift is measured against the goal text and the
  CLI requires it
- when the goal is intentionally broad ("assist the caller as needed")
- as a legal or compliance ruling; it is heuristic and advisory only
- for non-English transcripts; keyword extraction is English-only

## Workflow

### Audit a finished call

```bash
python3 scripts/goal_drift_auditor.py analyze \
  --transcript path/to/call-result.json \
  --goal-file path/to/goal.txt
```

Reads the real `get_call_run` result shape or flat fixture shape.
The goal file may be plain text or a JSON object with a `goal`,
`task`, or `objective` key. Emits a drift card:

- `goal_keywords[]`: content words extracted from the goal (sorted,
  4+ char, non-stop-word)
- `agent_turn_count` / `on_topic_turn_count` / `on_topic_ratio`
- `off_topic_spans[]`: each span of ≥ 2 consecutive agent turns without
  goal keywords, with `start_turn_index`, `length_in_agent_turns`, and
  PII-masked `first_off_topic_evidence`
- `goal_achieved`: `true` if goal keywords appear with a confirmation
  phrase in any of the last 4 agent turns
- `verdict`: `ON_TRACK` / `MILD_DRIFT` / `SIGNIFICANT_DRIFT` /
  `GOAL_NOT_ACHIEVED`, plus `unclear` paths
- `recommended_action`: `no_action_required`, `monitor_and_consider_tighter_goal`,
  or `retry_with_tighter_goal` with guidance

### Craft a tighter, bounded goal

```bash
python3 scripts/goal_drift_auditor.py craft \
  --scenario goal-refocus \
  --goal-file path/to/goal.txt
```

When `--goal-file` is provided, the original goal is embedded into a
structured bounding template that instructs the agent to stay focused,
redirect off-topic tangents, and confirm goal achievement explicitly before
hanging up.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Grosz, B.J. & Sidner, C.L. — *Attention, Intentions, and the Structure of Discourse* (Computational Linguistics, Vol. 12, No. 3, 1986, aclanthology.org/J86-3001) | Foundational theory of intentional discourse structure: global discourse purpose vs. local focus; goal drift is when global purpose is displaced by local tangents. Cited 3000+ times |
| Grice, H.P. — *Logic and Conversation* (in Studies in the Way of Words, Harvard Univ. Press, 1989) | Maxim of Relevance: every conversational contribution should relate to the joint purpose; the theoretical basis for measuring on-topic ratio |
| Burdisso et al. — *Dialog2Flow: Pre-training Soft-Contrastive Action-Driven Sentence Embeddings for Automatic Dialog Flow Extraction* (EMNLP 2024, arXiv:2410.18481) | Methodology for tracking dialogue trajectory in action-space; off-topic turns are trajectories departing the action-region of the stated goal |
| Liang et al. — *TD-EVAL: Revisiting Task-Oriented Dialogue Evaluation by Combining Turn-Level Precision with Dialogue-Level Comparisons* (2025, arXiv:2504.19982) | Framework evaluating TOD agents by "conversation cohesion" and "policy compliance" at turn level — directly the methodology this skill operationalizes for goal adherence |
| Choubey et al. — *Turning Conversations into Workflows: A Framework to Extract and Evaluate Dialog Workflows for Service AI Agents* (Salesforce AI Research, ACL 2025, arXiv:2502.17321) | Empirical validation that goal adherence is measurable from customer-agent transcripts on ABCD/SynthABCD datasets |

This skill computes keyword overlap, on-topic ratio, and span detection
using deterministic regex/set logic. It does not use model internals and
labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-agent-certainty-calibrator` compares agent *fact accuracy* against
  goal facts; this skill compares agent *topic focus* against goal keywords.
- `call-script-compliance-auditor` checks compliance with a rigid script; this
  skill works from a natural goal description without requiring a script.
- `call-cross-call-consistency-checker` compares two calls horizontally; this
  skill audits one call vertically (goal vs. reality).
- `call-agent-commitment-tracker` detects forward-looking pledges; this skill
  detects backward-looking topic adherence.

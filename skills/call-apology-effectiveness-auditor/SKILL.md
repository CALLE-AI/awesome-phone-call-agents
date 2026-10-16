---
name: call-apology-effectiveness-auditor
description: Offline heuristic CALL-E transcript skill that detects callee grievances and grades the agent's response against the six-component apology effectiveness taxonomy (acknowledgment, repair, explanation, regret, forbearance, forgiveness request) with rote/empathic/explanatory typology, plus an apology-protocol goal template. It is not a sincerity measure, relationship counseling, or authorization to act automatically.
license: MIT
---

# call-apology-effectiveness-auditor

> **"I'm sorry you feel that way" is not an apology. It is a complaint
> about the person who had one.**

Apology effectiveness is component-decomposable: research on real
conflict apologies shows that a working apology is not one utterance but
a stack of parts - acknowledgment of responsibility, concrete repair,
brief explanation, expressed regret, forbearance, and (optionally) a
request for forgiveness - and that acknowledgment carries the most
weight. When a callee raises a grievance on a call, an agent that says
only "I'm sorry about that" and moves on to scheduling has produced a
rote apology: audible, and empty. This skill detects the grievance and
grades the recovery response against that component stack.

## When To Use

- after support, collections, or clinic calls where the callee may have
  raised a grievance (delay, broken promise, repeated contact)
- in QA pipelines, to find calls where the recovery was rote, deflecting,
  or missing entirely
- before recovery callbacks, to craft an apology-protocol goal that names
  the miss and offers concrete repair

## When Not To Use

- as a measure of sincerity or relationship health; the components are
  surface-lexical markers - an agent can say "that's on us" with no
  feeling behind it
- to force apologies on every failure; sometimes the right posture is no
  apology at all, because the agent cannot own fault it does not have
- during a call; strictly post-call analysis plus pre-call goal crafting
- on non-English transcripts; the lexicons are English-only

## Workflow

### Audit a finished call

```bash
python3 scripts/apology_effectiveness_auditor.py analyze \
  --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat fixture shape used by sibling skill fixtures. Emits a card:

- `grievance_turn_index` / `grievances_total` / `grievance_evidence`:
  where the first grievance was voiced (callee turns only), how many
  grievance-bearing callee turns exist, and the masked evidence sentence
- `apology_detected` / `apology_evidence`: whether any agent turn from the
  grievance onward contains an apology, and the masked sentence
- `components_present`: the six-component markers found in the graded
  window (the apology sentence plus the following agent turn, since
  explanations often arrive one turn late)
- `typology`: `rote` / `empathic` / `explanatory` (empathic > explanatory
  > rote)
- `verdict`: `EFFECTIVE_APOLOGY` (acknowledgment plus repair or
  explanation) / `PARTIAL_APOLOGY` / `NON_APOLOGY` (deflection override) /
  `GRIEVANCE_UNADDRESSED` / `NO_GRIEVANCE`, plus `unclear` paths (empty
  transcript, fewer than two turns)

Only the FIRST grievance's response window is graded; later grievances
are counted in `grievances_total` but their responses are not separately
graded.

### Craft the apology-protocol goal

```bash
python3 scripts/apology_effectiveness_auditor.py craft --scenario apology-protocol
```

Emits the plan_call inputs JSON whose goal implements the protocol:
acknowledge the specific miss, offer concrete repair, explain briefly
only after acknowledging, and never use "sorry you feel that way"
constructions.

## Scientific Foundation

| Research | Relevance |
|---|---|
| An Exploration of the Structure of Effective Apologies (Lewicki, Polin & Lount, Negotiation and Conflict Management Research 9(1), 2016, doi 10.1111/ncmr.12073) | Empirically ranks six apology components; acknowledgment of responsibility carries the most weight - our EFFECTIVE threshold requires it |
| A Critical Review of Apology in AI Systems (Harland et al., arXiv 2412.15787, 2024) | First synthesis of AI apology research: apologies are routine in chatbots but rarely designed - motivates auditing them on calls |
| Who's Sorry Now: User Preferences Among Rote, Empathic, and Explanatory Apologies from LLM Chatbots (Ashktorab et al., arXiv 2507.02745, 2025) | Users distinguish apology TYPES; preference data grounds our rote/empathic/explanatory typology |

Citation notes recorded during verification: all three web-verified
2026-10-01. CORRECTION recorded: the frequently cited "2014 component
structure of interpersonal apologies" title does not exist - the
empirical six-component study is the 2016 NCMR paper by Lewicki, Polin &
Lount (not "Polite").

## Differences from sibling skills

- `call-disfluency-stress-profiler` measures stress markers as they
  happen; this skill grades the recovery RESPONSE after a grievance is
  voiced.
- `call-repair-sequence-auditor` scores micro-level conversational repair
  (huh/repeat/rephrase); this skill scores macro-level relational
  recovery.
- `call-agent-commitment-tracker` tracks future obligations; a repair
  offer is graded for FORM here and tracked as an OBLIGATION there.

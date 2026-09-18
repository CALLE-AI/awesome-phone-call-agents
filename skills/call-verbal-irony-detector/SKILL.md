---
name: call-verbal-irony-detector
description: Post-call pragmatics skill. Analyses a CALL-E transcript for verbal irony - the mismatch between what the callee literally says (positive words) and what they mean (negative intent) in complaint contexts - using an irony-marker lexicon plus context-contrast scoring. Returns a structured card with evidence spans, calibrated confidence or an explicit abstention, and a ready-to-use de-escalation goal for the next plan_call. Heuristic mode only, runs offline. Grounded in SarcNet (LREC-COLING 2024) and MUStARD++ (arXiv 2310.01430), adapted to text-only transcripts.
license: MIT
---

# call-verbal-irony-detector

> **What was said is not always what was meant.**

`call-summarizer` reports caller sentiment - what was said. This skill detects
verbal irony - the mismatch between the two - and turns it into the next
call's strategy. A callee who answers "Oh, great. Just perfect." after a
complaint is not happy, and an agent that acts on the literal words will
make it worse.

## When To Use

- after any CALL-E call where the outcome hinges on a positive-sounding
  answer inside a complaint discussion
- to decide whether a follow-up call should use a de-escalation goal
- to generate that de-escalation goal for `plan_call` directly

## When Not To Use

- to detect sentiment in general; use `call-summarizer` for that
- to detect fraud or social engineering; use `call-fraud-shield`
- during a call; this is strictly post-call analysis plus pre-call goal
  crafting, because CALL-E exposes transcripts, not live audio
- as proof of the callee's emotional state; text-only irony cues are
  ambiguous and the card says so

## Workflow

### Analyze a finished call

```bash
python3 scripts/irony_detector.py analyze --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. Emits a card:

- `irony_detected` + `confidence` (high / medium / low / none)
- `evidence`: turn index, masked span, matched rules
- `irony_assessment: "unclear"` with a reason when the callee never spoke
- `recommended_action`: `retry_with_deescalation_goal` (with the goal text),
  `verify_literal_intent_prompt`, or `continue`

### Craft the follow-up goal

```bash
python3 scripts/irony_detector.py craft --scenario complaint-followup --language en
```

Emits the plan_call inputs JSON whose `goal` is the same de-escalation
template the card recommends, so analysis and next call stay consistent.

## Scientific Foundation

| Research | Relevance |
|---|---|
| SarcNet: A Multilingual Multimodal Sarcasm Detection Dataset (LREC-COLING 2024) | Motivates marker + context mismatch detection; we use the text modality only |
| Sarcasm in Sight and Sound / MUStARD++ (arXiv 2310.01430) | Multimodal sarcasm benchmark incl. speech; our contrast rule is a text-only approximation |

Both papers study multimodal sarcasm; CALL-E exposes transcripts without
prosody, so this skill deliberately implements the text-side approximation
and labels every output `analysis_mode: "heuristic"`.

## Differences from sibling skills

- `call-summarizer` reports stated sentiment; this skill reports the
  stated-vs-meant mismatch and changes the next call's goal.
- `call-review` audits call compliance; this skill tunes conversational
  strategy.

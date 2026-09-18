---
name: call-cross-lingual-emotion-preservation
description: Post-call QA skill for cross-language relays. Compares the requester's emotional intensity (from their original call result or an operator note) against what the relayed CALL-E call actually expressed in the agent's own turns, using an English urgency-intensity lexicon. Returns a parity card with FLATTENED / PRESERVED / AMPLIFIED drift, a parity score, evidence spans from both sides, and either a proceed action or an intensity-calibrated relay goal for the next plan_call. Companion to language-bridge-call; it audits and calibrates, never relays. Heuristic mode only, runs offline. Intensity-mapping design informed by zero-shot emotion transfer research (ZEST, ICASSP 2024).
license: MIT
---

# call-cross-lingual-emotion-preservation

> **When the message crosses a language, does the urgency survive?**

`language-bridge-call` relays a request across languages in two legs. This
skill is its QA companion: it checks whether the second leg preserved the
emotional intensity of the first. A panicked "today, immediately, please"
that arrives as "sometime this week would be fine" is a failed relay even
when the words are translated correctly.

## When To Use

- after a `language-bridge-call` relay, to check the requester's urgency
  survived the second leg
- after any translated CALL-E call where emotional subtext matters
  (escalations, care requests, time-critical arrangements)
- to generate an intensity-calibrated relay goal for the next `plan_call`

## When Not To Use

- to relay or translate anything; use `language-bridge-call`
- to detect sarcasm or stated-vs-meant mismatch; use
  `call-verbal-irony-detector`
- to audit the relay callee's own emotions; only the relay agent's
  expressed intensity is measured, because the relay speaks on the
  requester's behalf
- on non-English source contexts; the intensity lexicon is English-only
  (the relay target language does not matter - CALL-E's language
  parameter handles that, and only the English source side is scored)

## Workflow

### Analyze a relay

```bash
python3 scripts/emotion_preservation.py analyze --source-context path/to/source.json --relay-transcript path/to/relay.json
```

`--source-context` accepts the requester's call-result JSON (callee turns
are used) or a plain-text operator note. `--relay-transcript` accepts the
relay leg's CALL-E result (nested `get_call_run` or flat fixture shape).
Emits a card:

- `source_intensity` / `relay_intensity`: {score, level, markers}; the
  relay side counts AGENT turns only
- `drift`: FLATTENED / PRESERVED / AMPLIFIED (level comparison)
- `parity_score`: 1.0 equal, 0.5 adjacent, 0.0 two steps apart
- `evidence`: masked spans with matched markers, from both sides
- `emotion_assessment: "unclear"` with a reason when the source context is
  empty or the relay has no agent turns
- `recommended_action`: `re_relay_with_calibrated_goal` (with the goal text
  calibrated to the SOURCE intensity) or `proceed`

### Craft the calibrated relay goal

```bash
python3 scripts/emotion_preservation.py craft --scenario emotion-relay --intensity high --language en
```

Emits the plan_call inputs JSON whose `goal` is the same intensity-
calibrated template the card recommends on drift (high / medium / low).

## Scientific Foundation

| Research | Relevance |
|---|---|
| ZEST: Zero Shot Audio to Audio Emotion Transfer With Speaker Disentanglement (ICASSP 2024, arXiv 2401.04511) | Zero-shot emotion transfer between speakers; motivates intensity-preserving relay design |
| EELE: Exploring Efficient and Extensible LoRA Integration in Emotional Text-to-Speech (2024, arXiv 2408.10852) | Efficient emotional TTS control; motivates mapping intensity levels to concrete phrasing guidance |

Both papers build neural emotion-transfer systems; this skill deliberately
implements a lexical intensity mapper on transcripts only and labels every
output `analysis_mode: "heuristic"` - it is informed by that research, not
an implementation of it.

## Differences from sibling skills

- `language-bridge-call` performs the relay; this skill audits the relay's
  emotional fidelity and calibrates the next attempt.
- `call-semantic-barge-in-analyzer` profiles how the callee participated;
  this skill measures what the relay agent expressed on someone's behalf.

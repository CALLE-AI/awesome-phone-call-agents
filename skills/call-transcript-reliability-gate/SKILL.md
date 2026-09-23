---
name: call-transcript-reliability-gate
description: Offline experimental CALL-E transcript auditor that grades a returned transcript RELIABLE, SUSPECT, or UNUSABLE from text-visible ASR-hallucination symptoms before anything acts on it, and crafts ASR-risk-aware goals. It is not proof of hallucination, not a transcription accuracy certificate, and not authorization to act.
license: MIT
---

# call-transcript-reliability-gate

> **Before you trust what the phone heard, check how it was written down.**

Every verification skill in this repository - `call-review`,
`verity-verification-core`, `provenance-grade`, `exact-ref` - starts from the
same assumption: the transcript is ground truth. This skill audits that
assumption. Speech-to-text systems hallucinate fluent text with no basis in
the audio, and those hallucinations disproportionately appear as loops,
caption-credit boilerplate, and even harmful phantom content. A downstream
verdict built on a hallucinated confirmation is wrong with perfect
confidence.

## When To Use

- after any CALL-E call whose result will be written somewhere (booking,
  record update, payment) and before other transcript skills consume it
- when a summary contains values the transcript turns seem to repeat
  oddly, or boilerplate no phone caller would say
- before placing a number-critical call, to craft a goal that reduces
  transcription risk in the first place

## When Not To Use

- to prove the provider hallucinated; text signals are advisory reasons to
  re-confirm, not verdicts about the audio
- during a call; this is strictly post-call transcript analysis plus
  pre-call goal crafting, because CALL-E exposes transcripts, not live audio
- as a replacement for word-level confidence scores; CALL-E does not expose
  them, and this skill says so
- to authorize any action; verdicts route work to humans, they never
  permit anything

## Workflow

### Gate a finished call

```bash
python3 scripts/transcript_reliability_gate.py analyze --transcript path/to/call-result.json
```

Reads the real `get_call_run` result shape (`{status, result: {transcript}}`)
or the flat shape used by sibling skill fixtures. Emits a card:

- `verdict`: `RELIABLE` / `SUSPECT` / `UNUSABLE`
- `evidence`: turn index, masked span, matched rules
- `signals_summary`: counts per rule - `loop_repetition` (same 3+-word
  phrase repeated 3+ times in one turn), `boilerplate_phantom` (caption
  credits and video boilerplate that non-speech audio triggers),
  `harm_violence` / `harm_extremism` / `harm_slur_prefix` (documented
  hallucination harm categories - always routed to human review),
  `non_english_insertion` (script switch mid-call), `empty_turn`,
  `no_callee_turns`, `single_turn_call`, `extreme_turn_length`,
  `empty_word_content`
- `fields_to_reconfirm`: numbers and date words inside suspect turns,
  masked
- `recommended_action`: `proceed_with_caution`, `reverify_key_fields`, or
  `do_not_act_on_transcript`

Confidence is not claimed. Labels are fixed heuristic outcomes, not
empirically calibrated probabilities, and every card says so.

### Craft an ASR-risk-aware goal

```bash
python3 scripts/transcript_reliability_gate.py craft --scenario number-critical-call
```

Emits the plan_call inputs JSON whose goal instructs digit-by-digit values,
read-back requests, and keep-talking-during-holds behavior, so analysis and
the next call stay consistent.

## Scientific Foundation

| Research | Relevance |
|---|---|
| Careless Whisper: Speech-to-Text Hallucination Harms (Koenecke et al., ACM FAccT 2024, arXiv 2402.08021) | Documents hallucination rates and the harm taxonomy (38% of studied hallucinations contain explicit harms) our harm rules approximate |
| Lost in Transcription, Found in Distribution Shift: Demystifying Hallucination in Speech Foundation Models (Atwany et al., ACL 2025, arXiv 2502.12414) | Grounds the distribution-shift framing behind the language-switch and extreme-shape signals |
| Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio (Baranski et al., 2025, arXiv 2501.11378) | Grounds the boilerplate-phantom rules: music and silence trigger caption-credit text |
| From Text Metrics to Model Internals: A Study of Whisper ASR Hallucination Detection (Jasinski et al., Interspeech 2026, arXiv 2606.23060) | Establishes text-based hallucination detection as a paradigm on human-annotated data; our detectors are a text-only approximation of it |

CALL-E exposes transcripts without word-level confidence or audio, so this
skill implements the text-side approximation and labels every output
`analysis_mode: "heuristic"`. Citation notes: the FAcct paper's exact title
says "Speech-to-Text", and the Interspeech study's HALAS dataset is
human-annotated - our rules were not trained on it.

## Differences from sibling skills

- `call-review` audits whether a *trusted* transcript supports the
  structured result; this skill gates whether the transcript itself is
  trustworthy enough to audit.
- `provenance-grade` grades how the callee knew what they said; this skill
  grades whether what they said was even transcribed faithfully.
- `conversation-clarify` resolves ambiguity by placing a call; this skill
  reduces ambiguity creation in the next call's goal.

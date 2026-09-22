# Examples: call-transcript-reliability-gate

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: a suspect confirmation turn (loop repetition)

Fixture: `references/example-transcript.json` - a pharmacy delivery
reschedule where the callee's confirmation turn degenerates into a
three-times-repeated phrase, the classic ASR loop symptom on noisy audio.

Command:

```bash
python3 skills/call-transcript-reliability-gate/scripts/transcript_reliability_gate.py analyze \
  --transcript skills/call-transcript-reliability-gate/references/example-transcript.json
```

Output:

```json
{
  "skill": "call-transcript-reliability-gate",
  "analysis_mode": "heuristic",
  "reliability_assessment": "assessed",
  "reason": null,
  "verdict": "SUSPECT",
  "evidence": [
    {
      "turn_index": 3,
      "speaker": "callee",
      "span": "The 15th? Yeah that's fine yeah that's fine yeah that's fine go ahead.",
      "rules": [
        "loop_repetition"
      ]
    }
  ],
  "signals_summary": {
    "loop_repetition": 1
  },
  "fields_to_reconfirm": [
    "15"
  ],
  "harm_review_required": false,
  "recommended_action": {
    "action": "reverify_key_fields",
    "guidance": "Suspect turns contain numbers or dates. Re-confirm these values through a second channel or a follow-up question before writing them anywhere."
  },
  "disclaimer": "Heuristic text-only analysis. These signals are reasons to re-confirm values or seek the audio, not proof that the provider hallucinated. A clean verdict does not certify transcription accuracy."
}
```

The date "15" sits inside the suspect turn, so the card routes it to
re-confirmation instead of trusting the parse.

## Example 2: a clean call (no text-visible symptoms)

Fixture: `references/example-transcript-clean.json`.

Command:

```bash
python3 skills/call-transcript-reliability-gate/scripts/transcript_reliability_gate.py analyze \
  --transcript skills/call-transcript-reliability-gate/references/example-transcript-clean.json
```

Output:

```json
{
  "skill": "call-transcript-reliability-gate",
  "analysis_mode": "heuristic",
  "reliability_assessment": "assessed",
  "reason": null,
  "verdict": "RELIABLE",
  "evidence": [],
  "signals_summary": {},
  "fields_to_reconfirm": [],
  "harm_review_required": false,
  "recommended_action": {
    "action": "proceed_with_caution",
    "guidance": "No text-visible hallucination symptoms. This is not a certificate of accuracy."
  },
  "disclaimer": "Heuristic text-only analysis. These signals are reasons to re-confirm values or seek the audio, not proof that the provider hallucinated. A clean verdict does not certify transcription accuracy."
}
```

RELIABLE means no text-visible symptoms fired - read the disclaimer: it is
not a certificate of transcription accuracy.

## Example 3: craft an ASR-risk-aware goal

Command:

```bash
python3 skills/call-transcript-reliability-gate/scripts/transcript_reliability_gate.py craft \
  --scenario number-critical-call
```

Output:

```json
{
  "skill": "call-transcript-reliability-gate",
  "mode": "craft",
  "scenario": "number-critical-call",
  "language": "en",
  "goal": "You are placing a call whose result depends on numbers, dates, or exact identifiers. Speak numbers one digit at a time and say each critical value twice, for example 'on the fifteenth of October - that is day one five'. After stating a critical value, ask the person to read it back to you, for example 'can you read that date back to me?'. If the person goes quiet or you hear hold music, keep saying a short acknowledgment every few seconds ('Are you still there?') instead of staying silent, then restate the last critical value once the person returns. If the person repeats a value back differently from what you said, do not accept either version silently - restate your version once more, digit by digit, and note the disagreement in the summary.",
  "notes": [
    "Heuristic skill: this template is a starting point; adapt wording to the case.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

The goal feeds `plan_call` directly; the digit-by-digit and read-back
wording reduces the chance the NEXT transcript needs a SUSPECT card.

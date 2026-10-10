# Examples: call-motivational-interviewing-fidelity-auditor

All commands run from the skill root
(`skills/call-motivational-interviewing-fidelity-auditor`). Output
below is real CLI stdout, unedited.

## MI_ADHERENT - reflected, asked open, gated advice

```bash
python3 scripts/motivational_interviewing_fidelity_auditor.py analyze \
  --call-result references/example-call-result.json
```

```json
{
  "skill": "call-motivational-interviewing-fidelity-auditor",
  "call_id": "demo-mi-001",
  "verdict": "MI_ADHERENT",
  "counts": {
    "sentences": 10,
    "reflections": 2,
    "open_questions": 3,
    "closed_questions": 1,
    "affirmations": 1,
    "advice_with_permission": 0,
    "advice_without_permission": 0,
    "confront": 0,
    "warn": 0,
    "information_statements": 3
  },
  "ratios": {
    "reflections_per_question": 0.5,
    "open_question_share": 0.75
  },
  "change_talk_markers": 1,
  "advisories": [],
  "disclaimer": "Heuristic lexical coding inspired by the MITI 4.2.1 instrument; not certified MI coding, not a clinical judgment, not a quality label for any person, and not authorization to act. Counts and ratios are the product; the verdict is a coarse summary."
}
```

## NON_ADHERENT - three unpermitted advice sentences

```bash
python3 scripts/motivational_interviewing_fidelity_auditor.py analyze \
  --call-result references/example-call-result-nonadherent.json
```

```json
{
  "skill": "call-motivational-interviewing-fidelity-auditor",
  "call_id": "demo-mi-002",
  "verdict": "NON_ADHERENT",
  "counts": {
    "sentences": 5,
    "reflections": 0,
    "open_questions": 0,
    "closed_questions": 0,
    "affirmations": 0,
    "advice_with_permission": 0,
    "advice_without_permission": 3,
    "confront": 0,
    "warn": 0,
    "information_statements": 2
  },
  "ratios": {
    "reflections_per_question": null,
    "open_question_share": null
  },
  "change_talk_markers": 1,
  "advisories": [
    "low_sample"
  ],
  "disclaimer": "Heuristic lexical coding inspired by the MITI 4.2.1 instrument; not certified MI coding, not a clinical judgment, not a quality label for any person, and not authorization to act. Counts and ratios are the product; the verdict is a coarse summary."
}
```

## NOT_MI_CALL - no callee change talk, honest abstention

```bash
python3 scripts/motivational_interviewing_fidelity_auditor.py analyze \
  --call-result references/example-call-result-not-mi.json
```

```json
{
  "skill": "call-motivational-interviewing-fidelity-auditor",
  "call_id": "demo-mi-003",
  "verdict": "NOT_MI_CALL",
  "counts": {
    "sentences": 3,
    "reflections": 0,
    "open_questions": 0,
    "closed_questions": 0,
    "affirmations": 0,
    "advice_with_permission": 0,
    "advice_without_permission": 1,
    "confront": 0,
    "warn": 0,
    "information_statements": 2
  },
  "ratios": {
    "reflections_per_question": null,
    "open_question_share": null
  },
  "change_talk_markers": 0,
  "advisories": [
    "low_sample"
  ],
  "disclaimer": "Heuristic lexical coding inspired by the MITI 4.2.1 instrument; not certified MI coding, not a clinical judgment, not a quality label for any person, and not authorization to act. Counts and ratios are the product; the verdict is a coarse summary."
}
```

## PARTIALLY_ADHERENT - closed-heavy questioning, zero reflections

```bash
python3 scripts/motivational_interviewing_fidelity_auditor.py analyze \
  --call-result references/example-call-result-partial.json
```

```json
{
  "skill": "call-motivational-interviewing-fidelity-auditor",
  "call_id": "demo-mi-004",
  "verdict": "PARTIALLY_ADHERENT",
  "counts": {
    "sentences": 9,
    "reflections": 0,
    "open_questions": 0,
    "closed_questions": 4,
    "affirmations": 0,
    "advice_with_permission": 0,
    "advice_without_permission": 0,
    "confront": 0,
    "warn": 0,
    "information_statements": 5
  },
  "ratios": {
    "reflections_per_question": 0.0,
    "open_question_share": 0.0
  },
  "change_talk_markers": 1,
  "advisories": [],
  "disclaimer": "Heuristic lexical coding inspired by the MITI 4.2.1 instrument; not certified MI coding, not a clinical judgment, not a quality label for any person, and not authorization to act. Counts and ratios are the product; the verdict is a coarse summary."
}
```

## craft

```bash
python3 scripts/motivational_interviewing_fidelity_auditor.py craft
```

```text
GOAL: call the patient about their medication refill using Motivational Interviewing.
ENGAGE: open with an open question about how they are managing the medication.
OARS: use Open questions, Affirmations, Reflective listening ("It sounds like..."), and Summaries.
PERMISSION: before any suggestion, ask permission ("Would you mind if I shared what other patients try?").
ROLL WITH RESISTANCE: never argue for change; reflect ambivalence ("Part of you wants to..., and part of you...").
CLOSE: summarize what the patient said and let THEM choose the next step.
```

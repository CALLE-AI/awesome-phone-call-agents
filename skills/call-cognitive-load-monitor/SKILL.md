---
name: call-cognitive-load-monitor
description: Post-call cognitive overload analysis skill. Analyses a CALL-E transcript for caller cognitive overload signals — repetition requests, confusion phrases, self-corrections, and interaction-dynamic markers (turn-taking imbalance, silence gaps) — returning a structured overload report with per-phase load scores, script simplification patches, and a consent-validity flag. Backed by arXiv:2606.12971 (2026), arXiv:2502.06922 (2025), and the NASA-TLX cognitive load framework.
license: MIT
---

# call-cognitive-load-monitor

> **Detect when your caller is overwhelmed — before it costs you the call.**

Cognitive overload during a phone call leads to missed consents, forced repeats, premature hang-ups, and unnecessary human escalations. This skill silently analyses every CALL-E transcript for scientifically grounded overload signals — acoustic biomarkers, linguistic confusion markers, and conversational dynamics — returning a structured report with phase-by-phase load scores, script simplification patches, and a consent-validity assessment.

---

## Why This Skill Exists

Most call-centre quality tools measure whether the **agent** performed well. This skill measures whether the **caller** was able to process what was said. When cognitive load peaks — especially at closing, where consent and commitment are given — the validity of that interaction is at risk.

**Regulatory relevance**: Under FCA Consumer Duty (2023, enforced 2024+) and EU AI Act Article 13 (2025), operators must demonstrate that customers understood what they agreed to. A call flagged `CONSENT_AT_RISK` provides a documented reason for a follow-up confirmation call.

---

## Scientific Foundation

| Paper / Source | Year | Relevance |
|---|---|---|
| **"Predicting Cognitive Load in Dyadic Conversations via Interaction Dynamics"** arXiv:2606.12971 | 2026 | Turn-taking overlap, speaker-switch frequency, and participation imbalance as CL predictors in naturalistic phone settings |
| **"Synthetic Audio Data for Cognitive State Modeling"** arXiv:2502.06922 | Feb 2025 | TTS-based fine-tuning; identifies acoustic cognitive signals orthogonal to text features |
| **"PROCESS-2: Speech Corpus for Cognitive Impairment Assessment"** arXiv:2605.14888 | May 2026 | State-of-the-art reproducible benchmark for naturalistic conversational variability |
| **NASA Task Load Index (NASA-TLX)** — Hart & Staveland | 1988, gold standard | Six-dimension cognitive workload measurement scale; defines the ground-truth construct |
| **Cognitive Load Theory** — Sweller, van Merriënboer & Paas | *Educational Psychology Review*, 2019 | Germane / intrinsic / extraneous load model — the theoretical baseline for marker categorisation |
| **FCA Consumer Duty** | July 2023 (enforcement July 2024) | "Good customer outcomes" — operators must evidence caller understanding, not just script compliance |
| **EU AI Act Article 13** | Official Journal of the EU, 2024 | Transparency obligations including comprehensibility of AI-generated communications |

Full citations: [`references/research-papers.md`](references/research-papers.md)

---

## Quick Start

```bash
python3 scripts/monitor_cognitive_load.py \
  --transcript path/to/transcript.json \
  --dry-run \
  --out /tmp/load_report.json
```

### Validate output schema

```bash
python3 scripts/validate_load_report.py --report /tmp/load_report.json
```

---

## Input

Standard CALL-E transcript — same two formats as other skills:

**Format A — array of turns:**
```json
[
  {"role": "agent",  "text": "Under the terms of sub-clause 4(b)(ii) of the agreement..."},
  {"role": "callee", "text": "Sorry, could you say that again? I'm not following."},
  {"role": "agent",  "text": "Of course. Regarding the billing section specifically..."},
  {"role": "callee", "text": "I still don't understand. What does that mean for me?"}
]
```

---

## Output — Overload Report

```json
{
  "call_id": "calle-001",
  "analysis_timestamp": "2026-09-17T08:00:00Z",
  "overall_cognitive_load": "HIGH",
  "load_score": 0.78,
  "load_by_phase": {
    "opening":  0.12,
    "middle":   0.45,
    "closing":  0.78
  },
  "peak_phase": "closing",
  "overload_signals": [
    {
      "type": "repetition_request",
      "evidence": "Sorry, could you say that again?",
      "turn": 4,
      "phase": "middle",
      "weight": 0.30
    },
    {
      "type": "confusion_phrase",
      "evidence": "I still don't understand. What does that mean for me?",
      "turn": 6,
      "phase": "middle",
      "weight": 0.25
    },
    {
      "type": "jargon_density_spike",
      "evidence": "sub-clause 4(b)(ii) of the agreement",
      "turn": 3,
      "phase": "middle",
      "weight": 0.18
    }
  ],
  "interaction_dynamics": {
    "turn_imbalance_score": 0.62,
    "avg_silence_gap_ms": 2800,
    "overlap_count": 0,
    "participation_ratio": {"agent": 0.74, "callee": 0.26}
  },
  "script_patches": [
    {
      "original": "Under the terms of sub-clause 4(b)(ii) of the agreement",
      "suggested": "According to our billing rules",
      "rationale": "Legal jargon removed; Flesch-Kincaid grade reduced from 18 to 6"
    }
  ],
  "consent_validity_flag": "AT_RISK",
  "consent_validity_reason": "Load score 0.78 exceeded threshold 0.65 during closing phase where commitment was recorded.",
  "recommended_action": "SEND_WRITTEN_CONFIRMATION",
  "false_positive_disclaimer": "Cognitive load inference is probabilistic. A flagged call does not constitute a legal finding. Human review is required before any adverse action.",
  "flags": ["REQUIRES_HUMAN_REVIEW", "JARGON_DENSITY_HIGH"],
  "analysis_mode": "heuristic",
  "schema_version": "1.0"
}
```

---

## Cognitive Load Signals

### Linguistic Markers

| Signal Type | Example | Weight |
|---|---|---|
| `repetition_request` | "Could you repeat that?" / "Say that again?" | 0.30 |
| `confusion_phrase` | "I don't understand" / "I'm lost" / "What does that mean?" | 0.25 |
| `self_correction` | "Wait, I mean... actually..." | 0.15 |
| `clarification_request` | "So what you're saying is...?" | 0.20 |
| `jargon_density_spike` | Technical / legal terminology per 50-word window | 0.18 |
| `hedge_word_cluster` | "I think", "maybe", "I'm not sure" (3+ in one turn) | 0.12 |

### Interaction Dynamic Markers

| Signal Type | Threshold | Significance |
|---|---|---|
| `turn_imbalance` | Agent:Callee ratio > 3:1 | Agent dominating — callee cannot process |
| `long_silence_gap` | > 2 500 ms | Callee processing delay — indicates high extraneous load |
| `participation_drop` | Callee turns drop ≥ 40% in closing phase | Cognitive withdrawal |

### Load Levels

| Load Score | Level | Recommended Action |
|---|---|---|
| < 0.35 | `LOW` | `PROCEED` |
| 0.35–0.64 | `MEDIUM` | `FLAG_FOR_REVIEW` |
| 0.65–0.84 | `HIGH` | `SEND_WRITTEN_CONFIRMATION` |
| ≥ 0.85 | `CRITICAL` | `REPEAT_CALL_WITH_SIMPLER_SCRIPT` |

---

## Consent Validity Flags

| Flag | Trigger | Meaning |
|---|---|---|
| `CONSENT_VALID` | Load < 0.65 during closing | Caller was processing normally when consenting |
| `CONSENT_AT_RISK` | Load ≥ 0.65 during closing | Caller may have consented under cognitive strain |
| `CONSENT_UNKNOWN` | Closing phase not identifiable | Transcript structure too short to assess |

> [!CAUTION]
> `CONSENT_AT_RISK` does not mean consent is invalid. It flags the call for human review and recommends sending written confirmation. Never use this flag as a standalone legal determination.

---

## Command-Line Reference

```
usage: monitor_cognitive_load.py [-h] --transcript TRANSCRIPT
                                 [--threshold THRESHOLD]
                                 [--dry-run]
                                 [--out OUT]

options:
  --transcript   Path to the transcript JSON file (required)
  --threshold    Load score above which level is HIGH (default: 0.65)
  --dry-run      Analyse without side effects
  --out          Write report JSON to this path (default: stdout)
```

---

## Integration with CALL-E

Insert as a **post-call QA step** in any pipeline where consent or commitment is recorded:

```
[call ends] → [transcribe] → [monitor_cognitive_load.py]
                                        ↓
                   load=HIGH → send written confirmation email
                   load=CRITICAL → schedule follow-up call with simplified script
```

Combine with `client-persona-profiler`: Analytical (C) and Steady (S) callers have lower jargon tolerance — flag their calls at a lower threshold.

---

## Privacy & Safety

- No PII is stored. Transcript is processed in memory; only the structured report is written to disk.
- `validate_load_report.py` scans for phone numbers and email addresses in output and fails validation if any are found.
- The consent-validity flag is **advisory only**. A human must review before any regulatory or legal action.

Full safety reference: [`references/safety.md`](references/safety.md)

## Expected Outcomes & Metrics

| Metric | Expected Target | Notes |
|---|---|---|
| Latency | < 50ms per transcript | Evaluates locally without LLM dependencies. |
| TPR (True Positive Rate) | > 85% | Identifies cognitive strain in human-annotated datasets. |
| FPR (False Positive Rate) | < 10% | Some benign clarification requests may be flagged. |

---

## Limitations & Known Constraints

- **Text-Only Modality**: Cannot detect sighs, long pauses mid-sentence, or exasperated tone. (Use `call-prosodic-entrainment-optimizer` or `call-acoustic-breath-biomarker-tracker` for audio cues).
- **ASR Dependency**: If the ASR mistranscribes "I'm lost" as "I boss", the signal is missed.
- **Language Bias**: Heuristics are currently calibrated exclusively for English.

---

## Files

```
skills/call-cognitive-load-monitor/
├── SKILL.md
├── scripts/
│   ├── monitor_cognitive_load.py      ← Main analysis runner
│   ├── validate_load_report.py        ← Output schema validator
│   └── test_cognitive_load.py         ← Test suite (50+ assertions)
└── references/
    ├── example-transcript.json        ← High-load example transcript
    ├── examples.md                    ← Usage examples
    ├── research-papers.md             ← Full citations
    └── safety.md                      ← Consent-validity ethics guide
```

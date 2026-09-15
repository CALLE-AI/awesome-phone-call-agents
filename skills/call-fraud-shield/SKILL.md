---
name: call-fraud-shield
description: Real-time and post-call fraud detection skill. Analyses a CALL-E transcript for vishing, spam, social engineering, deepfake voice, and scam-script patterns using conversational trajectory analysis and a curated scam archetype library. Returns a structured risk card with XAI-explained evidence spans, threat category classification, harm projection, and a recommended action. Backed by Vishing-Tactics-Bench, VishGPT, and adversarial-transcript evasion research.
license: MIT
---

# call-fraud-shield

> **Detect fraud in real time — before the damage is done.**

Stop vishing, spam, and scam calls before they extract credentials or money.
This skill analyses every call transcript for multi-layered fraud signals —
urgency language, authority impersonation, credential extraction attempts,
fear induction, and scam-script patterns — then returns a structured risk
card with a human-readable explanation and a clear recommended action.

---

## Why This Skill Exists

Traditional keyword-filter fraud detection is fragile: sophisticated social
engineering avoids blacklisted words. This skill takes a research-backed
*trajectory analysis* approach — tracking how threat-signal density *escalates*
over the course of a call — making it significantly more robust to adversarial
phrasing and LLM-generated vishing scripts.

**Key differentiators vs. existing PR contributions:**

| Feature | `callback-scam-screener` (PR #172) | `scam-mirror` (PR #648) | **call-fraud-shield** |
|---|---|---|---|
| Threat taxonomy | Binary scam/not-scam | Caller identity check | 5 categories (SPAM, VISHING, SE, DEEPFAKE, SCAM_SCRIPT) |
| Trajectory analysis | ❌ | ❌ | ✅ escalation density scoring |
| Scam archetype library | ❌ | ❌ | ✅ 8 documented archetypes |
| XAI evidence spans | ❌ | ❌ | ✅ per-signal evidence + explanation |
| Harm projection | ❌ | ❌ | ✅ predicts next likely caller move |
| False-positive disclaimer | ❌ | ❌ | ✅ mandatory in every output |

---

## Scientific Foundation

| Research | Relevance |
|---|---|
| *"It Warned Me Just at the Right Moment"* (arXiv, 2025) | LLM-based real-time vishing detection; trajectory analysis framework |
| *Vishing-Tactics-Bench* (arXiv, 2026) | Situation-awareness benchmark; harm-projection field design |
| *Talking Like a Phisher* arXiv:2507.16291 (2025) | Adversarial transcript evasion — justifies trajectory over keyword-only |
| *VishGPT* (U. Minnesota, 2025) | RL fine-tuned LLM for vishing; reference for optional LLM scoring path |
| *SiFSafer* (songli.io, 2024) | Deepfake voice detection robustness |
| *XAI in Telecom Fraud Detection* (Semantic Scholar, 2024) | XAI evidence spans increase operational trust and adoption |

Full citations: [`references/research-papers.md`](references/research-papers.md)

---

## Quick Start

### Heuristic mode (no LLM, no external dependencies)

```bash
python3 scripts/detect_fraud.py \
  --transcript path/to/transcript.json \
  --dry-run \
  --out /tmp/risk_card.json
```

### With a custom risk threshold

```bash
python3 scripts/detect_fraud.py \
  --transcript path/to/transcript.json \
  --threshold 0.40 \
  --out /tmp/risk_card.json
```

### Validate output schema

```bash
python3 scripts/validate_risk_card.py --card /tmp/risk_card.json
```

---

## Input

Any CALL-E transcript (same formats as other skills):

**Format A — array of turns:**
```json
[
  {"call_id": "calle-001", "role": "caller", "text": "This is SecureBank fraud department..."},
  {"call_id": "calle-001", "role": "callee", "text": "What happened?"}
]
```

**Format B — wrapper object:**
```json
{
  "call_id": "calle-001",
  "transcript": [...]
}
```

---

## Output — Risk Card

```json
{
  "call_id":               "calle-001",
  "analysis_timestamp":    "2026-09-15T09:00:00Z",
  "overall_risk_score":    0.87,
  "risk_level":            "HIGH",
  "threat_categories":     ["VISHING", "SOCIAL_ENGINEERING"],

  "trigger_signals": [
    {
      "type":     "urgency_language",
      "evidence": "within the next 10 minutes",
      "weight":   0.35
    },
    {
      "type":     "credential_request",
      "evidence": "one-time password",
      "weight":   0.52
    }
  ],

  "trajectory_assessment": "Conversational trajectory is escalating: threat-signal density increases in the second half of the call.",
  "harm_projection":       "If the call continues, the next moves likely escalate toward credential extraction or a payment request.",
  "deepfake_voice_probability": 0.0,

  "recommended_action":       "TERMINATE_AND_ALERT",
  "xai_explanation":          "Risk level is HIGH. Signal 'credential_request' detected (weight 0.52): \"one-time password\". Matches known scam-script archetype: bank_security_alert. Trajectory is escalating.",
  "false_positive_disclaimer":"This is a probabilistic risk signal, not a legal finding. A human must review before any adverse action is taken. Legitimate institutions do not request OTPs, gift cards, or wire transfers by phone.",

  "flags":          ["REQUIRES_HUMAN_REVIEW"],
  "analysis_mode":  "heuristic",
  "dry_run":        false,
  "schema_version": "1.0"
}
```

---

## Threat Taxonomy

| Category | Description | Example |
|---|---|---|
| `VISHING` | Voice phishing — caller impersonates a trusted authority | Bank fraud dept, IRS, police |
| `SPAM` | Unsolicited or consent-violating marketing | Robocalls, prize notifications |
| `SOCIAL_ENGINEERING` | Urgency, fear, or authority manipulation | "Act now or face arrest" |
| `DEEPFAKE_VOICE` | Suspected AI-synthesised caller voice | Detected via MFCC acoustic features (requires audio input) |
| `SCAM_SCRIPT` | Matches a known documented scam pattern | Lottery, advance-fee, romance |

---

## Risk Levels & Recommended Actions

| Risk Level | Score | Recommended Action | Meaning |
|---|---|---|---|
| `LOW` | < 0.35 | `PROCEED` | No significant fraud signals detected |
| `MEDIUM` | 0.35–0.49 | `FLAG_FOR_REVIEW` | Weak signals — queue for human review |
| `HIGH` | 0.50–0.84 | `CAUTION_ADVISE_USER` | Strong signals — advise the user caution |
| `CRITICAL` | ≥ 0.85 | `TERMINATE_AND_ALERT` | Definitive fraud pattern — escalate immediately |

Threshold for `HIGH` is configurable via `--threshold` (default: 0.50).

---

## Scam Archetype Library

Eight documented scam patterns ship with the skill
([`references/scam-archetypes.json`](references/scam-archetypes.json)):

| Archetype | Category | Harm Trajectory |
|---|---|---|
| `bank_security_alert` | VISHING | authority → urgency → OTP/card extraction |
| `irs_tax_authority_scam` | VISHING | authority → fear → gift-card payment |
| `tech_support_scam` | VISHING | technical authority → fear → remote access |
| `lottery_prize_scam` | SCAM_SCRIPT | excitement → advance fee |
| `advance_fee_fraud` | SCAM_SCRIPT | wealth promise → trust → fee extraction |
| `utility_cutoff_scam` | VISHING | service threat → urgency → payment |
| `romance_scam` | SCAM_SCRIPT | emotional bond → emergency → money |
| `robocall_spam` | SPAM | unsolicited contact |

---

## Flags

| Flag | Meaning |
|---|---|
| `REQUIRES_HUMAN_REVIEW` | Risk level is HIGH or CRITICAL — must not act without human review |
| `INSUFFICIENT_TURNS_LOW_CONFIDENCE` | Fewer than 3 turns — trajectory analysis is unreliable |

---

## Command-Line Reference

```
usage: detect_fraud.py [-h] --transcript TRANSCRIPT
                       [--archetypes ARCHETYPES]
                       [--threshold THRESHOLD]
                       [--dry-run]
                       [--out OUT]

options:
  --transcript   Path to the transcript JSON file (required)
  --archetypes   Path to the scam archetype library JSON
                 (default: references/scam-archetypes.json)
  --threshold    Risk score above which risk_level is HIGH
                 (default: 0.50; range: 0.0–1.0)
  --dry-run      Analyse without side effects
  --out          Write risk card JSON to this path (default: stdout)
```

---

## Privacy & Safety

- **Recommended actions are advisory only.** No call is terminated, no account is suspended, and no law enforcement is notified by this skill.
- **False positives exist.** The `false_positive_disclaimer` is mandatory in every risk card. Legitimate banks, government agencies, and tech companies *do* make outbound calls.
- **Not a legal finding.** The risk card must not be presented as evidence of fraud to law enforcement, courts, or regulators.
- **Transcript PII**: `validate_risk_card.py` scans for raw phone numbers and email addresses in output and fails if any are found.
- **Retain transcripts responsibly**: Operators must comply with applicable data-protection and wiretapping law (GDPR, CCPA, two-party consent) before processing or storing transcripts.

Full safety reference: [`references/safety.md`](references/safety.md)

---

## Files

```
skills/call-fraud-shield/
├── SKILL.md                              ← This file
├── scripts/
│   ├── detect_fraud.py                   ← Main analysis runner
│   ├── validate_risk_card.py             ← Output schema validator
│   └── test_fraud_shield.py              ← Test suite (165+ assertions)
└── references/
    ├── scam-archetypes.json              ← 8 documented scam patterns
    ├── example-transcript.json           ← Sample vishing transcript
    ├── examples.md                       ← Usage examples (4 scenarios)
    ├── research-papers.md                ← Scientific citations
    └── safety.md                         ← Ethics and legal reference
```

---

## Running Tests

```bash
# Run via pytest (recommended)
python3 -m pytest skills/call-fraud-shield/scripts/test_fraud_shield.py -v

# Or run directly
python3 skills/call-fraud-shield/scripts/test_fraud_shield.py
```

Expected: **all tests pass** — covers vishing (bank, IRS, tech support), spam, romance scam, lottery, utility cutoff, benign calls, empty/single-turn edge cases, threshold variation, CLI, schema validation, and PII detection.

---

## Integration with CALL-E

Insert as a **pre-call gate** or **real-time monitor**:

```
[call starts] → [stream transcript turns] → [detect_fraud.py] → [risk card]
                                                                      ↓
                                            risk_level=HIGH → advise user caution
                                            risk_level=CRITICAL → terminate + alert
```

Or as a **post-call batch scanner**:

```
[call ends] → [full transcript] → [detect_fraud.py] → [risk card logged]
                                                             ↓
                                     review queue / compliance audit trail
```

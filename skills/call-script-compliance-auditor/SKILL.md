---
name: call-script-compliance-auditor
description: Pre-call regulatory compliance verification skill. Checks a CALL-E call script clause-by-clause against a chosen regulatory profile (US_TCPA, EU_GDPR, UK_FCA, US_HIPAA) for required disclosures, prohibited language, and fair-treatment obligations. Returns a structured compliance report with PASS/WARN/FAIL verdicts and suggested compliant rewrites. Backed by arXiv:2026 Runtime Compliance Verification, PrivaCI-Bench (arXiv:2025), EU AI Act Art.12/52 (2025), and FCA Consumer Duty enforcement documentation.
license: MIT
---

# call-script-compliance-auditor

> **Verify your call script is legally compliant before a single dial is made.**

Existing script tools check tone and pronunciation. This skill checks **legality**: does the script contain every required disclosure, avoid every prohibited tactic, and meet the fair-treatment standards of the regulatory framework that governs your calls? It returns clause-level evidence for each check — PASS, WARN, or FAIL — and a suggested compliant rewrite for every failing clause.

---

## Why This Skill Exists

Every TCPA-regulated telemarketing call, every GDPR-covered first-contact call in the EU, every FCA-supervised financial promotion call in the UK, and every HIPAA-covered healthcare call in the US must meet specific mandatory disclosure requirements. Getting this wrong does not just produce a bad call — it produces **regulatory fines**.

| Jurisdiction | Regulator | Max Fine (2025) |
|---|---|---|
| US TCPA | FCC | $59,375 per willful violation |
| EU GDPR | DPA | €20M or 4% global turnover |
| UK FCA Consumer Duty | FCA | Unlimited (conduct-based) |
| US HIPAA | HHS OCR | $2M per violation category per year |

This skill runs **before** the call, as a gate in the CALL-E task creation pipeline.

---

## Scientific Foundation

| Paper / Source | Year | Relevance |
|---|---|---|
| **"Runtime Compliance Verification for AI Agents"** arXiv (2026) | 2026 | Policy-as-code predicate interception for AI agent actions — the architectural blueprint |
| **PrivaCI-Bench: Contextual Integrity for LLM Privacy Compliance** arXiv (2025) | 2025 | Benchmarks LLMs on GDPR/HIPAA clause-level understanding with 97.9% precision possible |
| **"Automated Regulatory Compliance Verification: Hybrid Rule-Based + XAI"** Semantic Scholar | 2025 | Hybrid symbolic-neural architecture for explainable, audit-ready compliance verdicts |
| **"Compliance-to-Code: Decomposing Regulations into Logical Components"** arXiv | 2025 | Maps legal "shall/must/must not" clauses to verifiable predicates — the checking engine |
| **EU AI Act** — Articles 12, 13, 52 | Official Journal of the EU, 2024 | Mandatory transparency, logging, and prohibition on certain emotional inferences for AI systems |
| **FCA Consumer Duty Final Rules** — PS22/9 | FCA, 2022 (enforced 2024) | Four-outcome framework: products, price, service, communications — scripts must meet "Consumer Understanding" outcome |
| **TCPA** 47 U.S.C. § 227 + FCC Rules | FCC Official (current) | Required consent disclosures, caller ID, opt-out language, and prohibited calling hours |
| **GDPR Articles 13 & 14** | Official Journal of the EU (current) | Required information disclosures on first contact |
| **HIPAA Privacy Rule** 45 C.F.R. § 164.510 | HHS (current) | Authorization and notice requirements for phone-based PHI disclosure |

Full citations: [`references/research-papers.md`](references/research-papers.md)

---

## Quick Start

```bash
python3 scripts/audit_script.py \
  --script path/to/script.txt \
  --jurisdiction UK_FCA \
  --dry-run \
  --out /tmp/compliance_report.json
```

### Supported Jurisdictions

| Code | Framework | Region |
|---|---|---|
| `US_TCPA` | Telephone Consumer Protection Act + FCC Rules | United States |
| `EU_GDPR` | General Data Protection Regulation Articles 13/14 | European Union |
| `UK_FCA` | FCA Consumer Duty (PS22/9) | United Kingdom |
| `US_HIPAA` | HIPAA Privacy Rule 45 C.F.R. § 164.510 | United States (Healthcare) |

---

## Input

**Format A — plain text script:**
```text
Hi, I'm calling from Acme Finance. This is a limited-time offer that expires tonight.
You'll get the best rate if you decide right now. Can I take your bank details?
```

**Format B — CALL-E task text (JSON):**
```json
{
  "task": "Call the customer and offer the loan product. Get consent for the credit check.",
  "jurisdiction": "UK_FCA"
}
```

---

## Output — Compliance Report

```json
{
  "script_hash": "sha256:3f9c8e2a...",
  "jurisdiction": "UK_FCA",
  "overall_verdict": "FAIL",
  "risk_level": "HIGH",
  "checks": [
    {
      "requirement_id": "FCA_CD_COMM_1",
      "requirement": "FCA Consumer Duty — Caller identity and firm name disclosure",
      "status": "PASS",
      "evidence": "I'm calling from Acme Finance",
      "regulation_ref": "FCA PS22/9 §4.21"
    },
    {
      "requirement_id": "FCA_CD_COMM_3",
      "requirement": "FCA Consumer Duty — No false urgency or pressure tactics",
      "status": "FAIL",
      "evidence": "This is a limited-time offer that expires tonight",
      "regulation_ref": "FCA PS22/9 §4.39(c)",
      "suggested_rewrite": "This offer is available for a limited period. Please take whatever time you need to consider it carefully."
    },
    {
      "requirement_id": "FCA_CD_COMM_4",
      "requirement": "FCA Consumer Duty — No pressure to decide immediately",
      "status": "FAIL",
      "evidence": "You'll get the best rate if you decide right now",
      "regulation_ref": "FCA PS22/9 §4.39(d)",
      "suggested_rewrite": "We can hold this rate for you while you consider. There is no rush."
    },
    {
      "requirement_id": "GDPR_ART13_1",
      "requirement": "GDPR Art.13 — Purpose of processing disclosure before data collection",
      "status": "FAIL",
      "evidence": "Can I take your bank details? [no purpose statement precedes this]",
      "regulation_ref": "GDPR Article 13(1)(c)",
      "suggested_rewrite": "We need your bank details to process your loan application. This data will be used only for that purpose and stored securely for 7 years per our retention policy. May I proceed?"
    }
  ],
  "pass_count": 1,
  "warn_count": 0,
  "fail_count": 3,
  "false_positive_disclaimer": "This is a heuristic legal analysis tool, not a substitute for qualified legal counsel. Always obtain professional legal review before deploying a call script in a regulated context.",
  "flags": ["REQUIRES_LEGAL_REVIEW", "PRESSURE_TACTIC_DETECTED"],
  "analysis_mode": "heuristic",
  "schema_version": "1.0"
}
```

---

## Requirement Library

Each jurisdiction ships with a built-in requirement library in [`references/compliance-rules.json`](references/compliance-rules.json):

### UK_FCA Consumer Duty (PS22/9)

| Req ID | Requirement | Status Type |
|---|---|---|
| `FCA_CD_COMM_1` | Caller identity and firm name | Mandatory — FAIL if absent |
| `FCA_CD_COMM_2` | FCA authorisation number available on request | WARN if absent |
| `FCA_CD_COMM_3` | No false urgency or artificial time pressure | Mandatory — FAIL if detected |
| `FCA_CD_COMM_4` | No pressure to decide immediately | Mandatory — FAIL if detected |
| `FCA_CD_COMM_5` | Opt-out mechanism offered | Mandatory — FAIL if absent |
| `FCA_CD_COMM_6` | Risk warnings for financial products | Mandatory — FAIL if absent |

### EU_GDPR Articles 13 & 14

| Req ID | Requirement | Status Type |
|---|---|---|
| `GDPR_ART13_1` | Purpose of data processing stated before collection | Mandatory |
| `GDPR_ART13_2` | Legal basis for processing stated | Mandatory |
| `GDPR_ART13_3` | Recipient categories of data disclosed | WARN |
| `GDPR_ART13_4` | Retention period or criteria disclosed | WARN |
| `GDPR_ART13_5` | Right to withdraw consent mentioned | Mandatory |

### US_TCPA

| Req ID | Requirement | Status Type |
|---|---|---|
| `TCPA_1` | Caller name and organisation disclosed at call start | Mandatory |
| `TCPA_2` | Opt-out mechanism offered during call | Mandatory |
| `TCPA_3` | No calls before 8am or after 9pm local time (metadata check) | Mandatory |
| `TCPA_4` | Written consent for autodialled marketing calls referenced | WARN |

---

## Command-Line Reference

```
usage: audit_script.py [-h] --script SCRIPT
                       [--jurisdiction JURISDICTION]
                       [--rules RULES]
                       [--dry-run]
                       [--out OUT]

options:
  --script        Path to call script file (plain text or JSON task) (required)
  --jurisdiction  Regulatory profile: US_TCPA | EU_GDPR | UK_FCA | US_HIPAA
                  (default: EU_GDPR)
  --rules         Path to custom compliance rules JSON (overrides built-in)
  --dry-run       Analyse without side effects
  --out           Write compliance report to this path (default: stdout)
```

---

## Privacy & Safety

- Scripts are hashed (SHA-256) before storage. Raw script text never reaches disk in the report.
- **This tool does not constitute legal advice.** The `false_positive_disclaimer` is mandatory in every report.
- Suggested rewrites are generated by heuristic pattern matching. Have qualified legal counsel review them before deployment.
- The requirement library is maintained as `references/compliance-rules.json` — operators should update it as regulations evolve.

Full safety reference: [`references/safety.md`](references/safety.md)

---

## Files

```
skills/call-script-compliance-auditor/
├── SKILL.md
├── scripts/
│   ├── audit_script.py              ← Main compliance runner
│   ├── validate_compliance_report.py ← Output schema validator
│   └── test_compliance_auditor.py   ← Test suite (70+ assertions)
└── references/
    ├── compliance-rules.json        ← Requirement library (4 jurisdictions)
    ├── example-script.txt           ← Non-compliant example script
    ├── examples.md                  ← Usage examples
    ├── research-papers.md           ← Full citations
    └── safety.md                    ← Legal disclaimer reference
```

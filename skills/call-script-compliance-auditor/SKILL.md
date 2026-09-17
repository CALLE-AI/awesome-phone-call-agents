---
name: call-script-compliance-auditor
description: Heuristic legal and regulatory compliance auditor for AI phone call scripts. Scans for required disclosures and prohibited high-pressure tactics.
version: 1.0.0
---

# Script Compliance Auditor

The `call-script-compliance-auditor` skill acts as a pre-flight checker for AI agent call scripts. Before an agent is allowed to dial, this skill scans the intended script to ensure it meets the legal and regulatory requirements of the specified jurisdiction.

## Supported Jurisdictions

- **UK_FCA**: Financial Conduct Authority (Consumer Duty rules).
- **EU_GDPR**: General Data Protection Regulation (Articles 7, 13, 14).
- **US_TCPA**: Telephone Consumer Protection Act.
- **US_HIPAA**: Health Insurance Portability and Accountability Act (Privacy Rule).

## Scientific & Regulatory Foundation

| Source | Relevance |
|---|---|
| **FCA PS22/9 Consumer Duty** | Prohibits high-pressure sales tactics and mandates clear identity disclosure for financial products. |
| **PrivaCI-Bench (2025)** | Benchmarks for evaluating LLM privacy compliance. This skill implements the heuristic pattern-matching layer of that pipeline. |
| **Runtime Compliance Verification (2026)** | Validates that autonomous agents verify their actions against a static ruleset before execution. |

## How it works

The skill parses the call script (either plain text or a JSON task definition) and runs it through a dictionary of regex-based rules for the chosen jurisdiction. 

Each rule is categorized as:
- **REQUIRED**: The script must contain specific language (e.g. "opt out"). Failure results in `FAIL`.
- **WARN_IF_ABSENT**: The script should probably contain this language (e.g. risk warnings), but its absence isn't an automatic failure. Results in `WARN`.
- **PROHIBITED**: The script must NOT contain this language (e.g. "this offer expires tonight"). Presence results in `FAIL`.

It outputs a structured JSON report with an `overall_verdict` (PASS, WARN, or FAIL), risk level, and suggested rewrites for any failed checks.

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| Regulatory Precision | > 95% | False positives (flagging compliant text) are acceptable; false negatives (missing a violation) are critical failures. |

## Limitations & Known Constraints
- **Heuristic Limitations**: This tool uses regex pattern matching. It does not possess deep semantic understanding. A highly obfuscated script might bypass the checks.
- **Not Legal Advice**: This is a technical guardrail, not a substitute for qualified legal counsel.

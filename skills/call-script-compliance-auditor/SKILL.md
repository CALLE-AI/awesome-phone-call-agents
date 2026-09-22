---
name: call-script-compliance-auditor
description: Heuristic legal and regulatory compliance auditor for AI phone call scripts. Scans for required disclosures and prohibited high-pressure tactics.
version: 1.0.0
---

# Script Compliance Auditor

The `call-script-compliance-auditor` skill is an offline experimental phrase checklist for AI-agent call scripts. Its PASS/WARN/FAIL labels describe heuristic checks only; they neither establish legal compliance nor authorize dialing. A qualified human must review real use.

## Supported Jurisdictions

- **UK_FCA**: Financial Conduct Authority (Consumer Duty rules).
- **EU_GDPR**: General Data Protection Regulation (Articles 7, 13, 14).
- **US_TCPA**: Telephone Consumer Protection Act.
- **US_HIPAA**: Health Insurance Portability and Accountability Act (Privacy Rule).

## Research & Regulatory Scope

The jurisdiction names label illustrative rule sets, not complete or current legal coverage. Research and regulatory links are background only; no published benchmark or legal clause-to-rule certification is claimed. See [research scope](references/research-papers.md).

## How it works

The skill parses the call script (either plain text or a JSON task definition) and runs it through a dictionary of regex-based rules for the chosen jurisdiction. 

Each rule is categorized as:
- **REQUIRED**: The script must contain specific language (e.g. "opt out"). Failure results in `FAIL`.
- **WARN_IF_ABSENT**: The script should probably contain this language (e.g. risk warnings), but its absence isn't an automatic failure. Results in `WARN`.
- **PROHIBITED**: The script must NOT contain this language (e.g. "this offer expires tonight"). Presence results in `FAIL`.

It outputs a structured JSON report with an `overall_verdict` (PASS, WARN, or FAIL), risk level, and suggested rewrites where implemented. Some failed rules have no rewrite suggestion.

## Expected Outcomes & Metrics

These are unvalidated design targets, not measured legal accuracy.

| Metric | Target | Notes |
|---|---|---|
| Regulatory Precision | > 95% | False positives (flagging compliant text) are acceptable; false negatives (missing a violation) are critical failures. |

## Limitations & Known Constraints
- **Heuristic Limitations**: This tool uses regex pattern matching. It does not possess deep semantic understanding. A highly obfuscated script might bypass the checks.
- **Not Legal Advice**: This is a technical guardrail, not a substitute for qualified legal counsel.

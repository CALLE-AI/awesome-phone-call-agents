#!/usr/bin/env python3
"""
call-script-compliance-auditor · audit_script.py

Checks a call script clause-by-clause against a regulatory profile.
Supported jurisdictions: US_TCPA, EU_GDPR, UK_FCA, US_HIPAA

Experimental scope: illustrative phrase checks, not verified legal coverage,
regulatory certification, or a reproduction of a published benchmark.
Report labels require qualified review and never authorize a real call.

Usage:
    python3 scripts/audit_script.py \
        --script path/to/script.txt \
        --jurisdiction UK_FCA \
        --dry-run --out /tmp/compliance_report.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Compliance rule library
# ---------------------------------------------------------------------------

RULES: dict[str, list[dict]] = {
    "UK_FCA": [
        {
            "req_id": "FCA_CD_COMM_1",
            "requirement": "FCA Consumer Duty — Caller identity and firm name disclosure",
            "regulation_ref": "Illustrative UK_FCA checklist; no verified clause mapping",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bmy name is\b", r"\bi'?m calling from\b",
                r"\bthis is .+ from\b", r"\bcalling on behalf of\b",
            ],
        },
        {
            "req_id": "FCA_CD_COMM_2",
            "requirement": "FCA Consumer Duty — FCA authorisation available on request",
            "regulation_ref": "Illustrative UK_FCA checklist; no verified clause mapping",
            "check_type": "WARN_IF_ABSENT",
            "presence_patterns": [
                r"\bFCA (authoris|authoriz)\w+\b", r"\bfinancial conduct authority\b",
                r"\bauthoris\w+ by\b", r"\bregulat\w+ by\b",
            ],
        },
        {
            "req_id": "FCA_CD_COMM_3",
            "requirement": "FCA Consumer Duty — No false urgency or artificial time pressure",
            "regulation_ref": "Illustrative UK_FCA checklist; no verified clause mapping",
            "check_type": "PROHIBITED",
            "prohibited_patterns": [
                r"\bexpires? (tonight|today|in \d+ (hour|minute))\b",
                r"\blimited( time)? offer\b",
                r"\bonce in a lifetime\b",
                r"\bact now\b",
                r"\bthis offer (won't|will not) last\b",
                r"\btoday only\b",
                r"\bends at midnight\b",
            ],
        },
        {
            "req_id": "FCA_CD_COMM_4",
            "requirement": "FCA Consumer Duty — No pressure to decide immediately",
            "regulation_ref": "Illustrative UK_FCA checklist; no verified clause mapping",
            "check_type": "PROHIBITED",
            "prohibited_patterns": [
                r"\bdecide (right now|immediately|on the call)\b",
                r"\byou (need|must|have) to decide\b",
                r"\bbest (rate|deal|price) if you (decide|sign|agree) (right )?now\b",
                r"\bif you hang up you'?ll lose\b",
                r"\bcan't hold this (rate|offer|price)\b",
            ],
        },
        {
            "req_id": "FCA_CD_COMM_5",
            "requirement": "FCA Consumer Duty — Opt-out mechanism offered",
            "regulation_ref": "Illustrative UK_FCA checklist; no verified clause mapping",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bopt.?out\b", r"\bno longer wish to receive\b",
                r"\bremove you from\b", r"\bwould you like to be removed\b",
                r"\bstop receiving\b", r"\bdo not contact\b",
            ],
        },
        {
            "req_id": "FCA_CD_COMM_6",
            "requirement": "FCA Consumer Duty — Risk warning for financial products",
            "regulation_ref": "Illustrative UK_FCA checklist; no verified clause mapping",
            "check_type": "WARN_IF_ABSENT",
            "presence_patterns": [
                r"\byour (home|property|capital) (may be|is) at risk\b",
                r"\bpast performance (is not|does not)\b",
                r"\binvestments can go (down|up and down)\b",
                r"\byou (could|may) lose\b",
                r"\brisk (of losing|to your)\b",
            ],
        },
    ],
    "EU_GDPR": [
        {
            "req_id": "GDPR_ART13_1",
            "requirement": "GDPR Art.13(1)(a) — Identity of the data controller disclosed",
            "regulation_ref": "GDPR Article 13(1)(a)",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bwe are\b", r"\bi'?m calling from\b", r"\bour company\b",
                r"\bour organisation\b", r"\bour organization\b",
            ],
        },
        {
            "req_id": "GDPR_ART13_2",
            "requirement": "GDPR Art.13(1)(c) — Purpose of data processing disclosed before collection",
            "regulation_ref": "GDPR Article 13(1)(c)",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bwe (need|use|will use|are collecting) (your |this )?(information|data|details) (to|for)\b",
                r"\bpurpose of (this call|collecting|processing)\b",
                r"\bthis (information|data) will be used\b",
            ],
        },
        {
            "req_id": "GDPR_ART13_3",
            "requirement": "Illustrative consent-withdrawal phrase check",
            "regulation_ref": "GDPR Article 13(2)(c)",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bwithdr(aw|awn) (your )?consent\b",
                r"\byou (can|may) opt.?out\b",
                r"\byou (can|may) withdraw\b",
                r"\bright to withdraw\b",
            ],
        },
        {
            "req_id": "GDPR_ART13_4",
            "requirement": "GDPR Art.13(2)(a) — Data retention period or criteria disclosed",
            "regulation_ref": "GDPR Article 13(2)(a)",
            "check_type": "WARN_IF_ABSENT",
            "presence_patterns": [
                r"\bkept for\b", r"\bret(ain|ention)\w+ (period|for)\b",
                r"\bstored for\b", r"\bdelete\w* after\b",
                r"\bpurge\w* after\b",
            ],
        },
        {
            "req_id": "GDPR_ART7",
            "requirement": "GDPR Art.7 — Consent obtained before collecting personal data",
            "regulation_ref": "GDPR Article 7",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bdo (i|we) have your (permission|consent)\b",
                r"\byou consent to\b",
                r"\bwith your (agreement|permission|consent)\b",
                r"\bmay (i|we) (proceed|collect|record|take)\b",
            ],
        },
    ],
    "US_TCPA": [
        {
            "req_id": "TCPA_1",
            "requirement": "TCPA §227(d) — Caller name and organisation disclosed at call start",
            "regulation_ref": "47 U.S.C. § 227(d)(3)(A)",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bmy name is\b", r"\bi'?m calling from\b",
                r"\bthis (call|message) is from\b",
                r"\bthis is .+ (at|from|with)\b",
            ],
        },
        {
            "req_id": "TCPA_2",
            "requirement": "TCPA §227(b) — Opt-out mechanism offered during call",
            "regulation_ref": "47 U.S.C. § 227(b)(2)(C)",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bopt.?out\b",
                r"\bdo not call\b",
                r"\bremove (you|your number)\b",
                r"\bpress \d+ to be removed\b",
                r"\bsay stop\b",
                r"\bno longer (wish|want) to be contacted\b",
            ],
        },
        {
            "req_id": "TCPA_3",
            "requirement": "TCPA — No robocall to numbers on the National Do Not Call Registry",
            "regulation_ref": "47 U.S.C. § 227(c) + 16 C.F.R. § 310.4(b)",
            "check_type": "WARN_IF_ABSENT",
            "presence_patterns": [
                r"\bdo not call (registry|list)\b",
                r"\bDNC\b",
            ],
        },
        {
            "req_id": "TCPA_4",
            "requirement": "TCPA — Telephone number/address of caller disclosed",
            "regulation_ref": "47 U.S.C. § 227(d)(3)(B)",
            "check_type": "WARN_IF_ABSENT",
            "presence_patterns": [
                r"\b\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}\b",
                r"\bcall us back at\b",
                r"\byou can reach us at\b",
                r"\bour number is\b",
            ],
        },
    ],
    "US_HIPAA": [
        {
            "req_id": "HIPAA_1",
            "requirement": "Illustrative healthcare caller identity phrase check",
            "regulation_ref": "Illustrative US_HIPAA checklist; no verified clause mapping",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bmy name is\b", r"\bi'?m calling from\b",
                r"\bthis is .+ (at|from|with)\b",
            ],
        },
        {
            "req_id": "HIPAA_2",
            "requirement": "Illustrative healthcare sensitive-term check, not a disclosure decision",
            "regulation_ref": "45 C.F.R. § 164.502(b)",
            "check_type": "PROHIBITED",
            "prohibited_patterns": [
                r"\bdiagnos\w+\b",
                r"\bprescri\w+\b",
                r"\bmedical record\b",
                r"\blab result\b",
                r"\btest result\b",
            ],
        },
        {
            "req_id": "HIPAA_3",
            "requirement": "Illustrative healthcare callee identity phrase check",
            "regulation_ref": "Illustrative US_HIPAA checklist; no verified clause mapping",
            "check_type": "REQUIRED",
            "presence_patterns": [
                r"\bam i speaking (with|to)\b",
                r"\bcan (i|you) (confirm|verify) (your|you are)\b",
                r"\byour (date of birth|date-of-birth|DOB)\b",
                r"\byour (member|patient|account) (number|id|ID)\b",
            ],
        },
    ],
}

# ---------------------------------------------------------------------------
# Checking engine
# ---------------------------------------------------------------------------

def script_text(path: str) -> str:
    p = Path(path)
    content = p.read_text(encoding="utf-8")
    try:
        data = json.loads(content)
        if isinstance(data, dict):
            return (
                data.get("task", "") + " " +
                data.get("script", "") + " " +
                data.get("text", "")
            ).strip()
        return content
    except json.JSONDecodeError:
        return content


def check_rule(rule: dict, text: str) -> dict:
    text_l = text.lower()
    req_type = rule["check_type"]

    if req_type in ("REQUIRED", "WARN_IF_ABSENT"):
        for pat in rule.get("presence_patterns", []):
            m = re.search(pat, text_l)
            if m:
                snippet = text[max(0, m.start() - 10):m.end() + 30].strip()
                return {
                    "requirement_id": rule["req_id"],
                    "requirement": rule["requirement"],
                    "status": "PASS",
                    "evidence": snippet[:100],
                    "regulation_ref": rule["regulation_ref"],
                }
        status = "FAIL" if req_type == "REQUIRED" else "WARN"
        return {
            "requirement_id": rule["req_id"],
            "requirement": rule["requirement"],
            "status": status,
            "evidence": None,
            "regulation_ref": rule["regulation_ref"],
            "suggested_rewrite": _suggest_rewrite(rule),
        }

    if req_type == "PROHIBITED":
        for pat in rule.get("prohibited_patterns", []):
            m = re.search(pat, text_l)
            if m:
                snippet = text[max(0, m.start() - 10):m.end() + 30].strip()
                return {
                    "requirement_id": rule["req_id"],
                    "requirement": rule["requirement"],
                    "status": "FAIL",
                    "evidence": snippet[:100],
                    "regulation_ref": rule["regulation_ref"],
                    "suggested_rewrite": _suggest_rewrite(rule),
                }
        return {
            "requirement_id": rule["req_id"],
            "requirement": rule["requirement"],
            "status": "PASS",
            "evidence": None,
            "regulation_ref": rule["regulation_ref"],
        }

    return {"requirement_id": rule["req_id"], "requirement": rule["requirement"],
            "status": "UNKNOWN", "regulation_ref": rule["regulation_ref"]}


REWRITE_HINTS: dict[str, str] = {
    "FCA_CD_COMM_3": (
        "This offer is available for a limited period. "
        "Please take whatever time you need to consider it carefully."
    ),
    "FCA_CD_COMM_4": (
        "We can hold this rate for you while you consider. There is no rush to decide today."
    ),
    "FCA_CD_COMM_1": (
        "Hello, my name is [AGENT_NAME] and I'm calling from [FIRM_NAME]."
    ),
    "FCA_CD_COMM_5": (
        "If you would like to opt out of future calls, please let me know and I will remove you from our list."
    ),
    "GDPR_ART13_1": (
        "We are [FIRM_NAME], contacting you about [PURPOSE]."
    ),
    "GDPR_ART13_2": (
        "We need your [data type] to [specific purpose]. "
        "This data will be used only for that purpose."
    ),
    "GDPR_ART13_3": (
        "You may withdraw your consent at any time by calling us or replying STOP."
    ),
    "TCPA_1": (
        "Hello, this is [AGENT_NAME] calling from [FIRM_NAME]."
    ),
    "TCPA_2": (
        "To be placed on our do-not-call list, please say 'stop' or press 9."
    ),
    "HIPAA_1": (
        "Hello, this is [AGENT_NAME] from [HEALTHCARE_ORGANISATION]."
    ),
    "HIPAA_3": (
        "Am I speaking with [PATIENT_NAME]? Could you please confirm your date of birth?"
    ),
    "HIPAA_2": (
        "This call is regarding your account. "
        "[Do not read clinical details — ask the patient to call back for specifics.]"
    ),
}


def _suggest_rewrite(rule: dict) -> str | None:
    return REWRITE_HINTS.get(rule["req_id"])


def overall_verdict(checks: list[dict]) -> str:
    statuses = {c["status"] for c in checks}
    if "FAIL" in statuses:
        return "FAIL"
    if "WARN" in statuses:
        return "WARN"
    return "PASS"


def risk_level(checks: list[dict]) -> str:
    fails = sum(1 for c in checks if c["status"] == "FAIL")
    if fails >= 3:
        return "CRITICAL"
    if fails >= 2:
        return "HIGH"
    if fails == 1:
        return "MEDIUM"
    warns = sum(1 for c in checks if c["status"] == "WARN")
    if warns >= 1:
        return "LOW"
    return "NONE"


def build_flags(checks: list[dict]) -> list[str]:
    flags: list[str] = []
    fails = [c for c in checks if c["status"] == "FAIL"]
    if fails:
        flags.append("REQUIRES_LEGAL_REVIEW")
    for check in fails:
        rid = check.get("requirement_id", "")
        if "PROHIBITED" in rid or check.get("requirement", "").startswith("FCA") and "No " in check.get("requirement", ""):
            flags.append("PRESSURE_TACTIC_DETECTED")
            break
    if sum(1 for c in checks if c["status"] == "FAIL") >= 2:
        flags.append("HIGH_COMPLIANCE_RISK")
    return list(dict.fromkeys(flags))  # deduplicate


# ---------------------------------------------------------------------------
# Main audit
# ---------------------------------------------------------------------------

def audit(
    script_path: str,
    jurisdiction: str = "EU_GDPR",
    dry_run: bool = True,
) -> dict:
    if jurisdiction not in RULES:
        raise ValueError(
            f"Unknown jurisdiction '{jurisdiction}'. "
            f"Valid options: {sorted(RULES.keys())}"
        )

    raw = script_text(script_path)
    script_hash = "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    rules = RULES[jurisdiction]

    checks = [check_rule(rule, raw) for rule in rules]
    
    # Compliance check for phone numbers (PR 288)
    phone_pattern = re.compile(r'\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b')
    for match in phone_pattern.finditer(raw):
        if not "555-01" in match.group():
            raise ValueError(f"Compliance Error: Real phone numbers are prohibited. Use 555-01xx range. Got {match.group()}")

    verdict = overall_verdict(checks)
    risk = risk_level(checks)
    flags = build_flags(checks)

    pass_c = sum(1 for c in checks if c["status"] == "PASS")
    warn_c = sum(1 for c in checks if c["status"] == "WARN")
    fail_c = sum(1 for c in checks if c["status"] == "FAIL")

    return {
        "script_hash": script_hash,
        "jurisdiction": jurisdiction,
        "overall_verdict": verdict,
        "risk_level": risk,
        "checks": checks,
        "pass_count": pass_c,
        "warn_count": warn_c,
        "fail_count": fail_c,
        "false_positive_disclaimer": (
            "This is a heuristic legal analysis tool, not a substitute for qualified legal "
            "counsel. Always obtain professional legal review before deploying a call script "
            "in a regulated context."
        ),
        "flags": flags,
        "analysis_mode": "heuristic",
        "dry_run": dry_run,
        "schema_version": "1.0",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Check a call script for regulatory compliance.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--script", required=True,
                        help="Path to call script (plain text or JSON task)")
    parser.add_argument("--jurisdiction",
                        choices=list(RULES.keys()), default="EU_GDPR",
                        help="Regulatory profile (default: EU_GDPR)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Analyse without side effects")
    parser.add_argument("--out", default=None,
                        help="Write report JSON to this path (default: stdout)")
    args = parser.parse_args()

    report = audit(
        script_path=args.script,
        jurisdiction=args.jurisdiction,
        dry_run=args.dry_run,
    )

    output = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"[call-script-compliance-auditor] Report written to {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()

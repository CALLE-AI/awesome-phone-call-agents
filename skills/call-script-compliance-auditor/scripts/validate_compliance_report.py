#!/usr/bin/env python3
"""validate_compliance_report.py — Schema validator for compliance auditor output."""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

VALID_VERDICTS  = {"PASS", "WARN", "FAIL"}
VALID_RISK      = {"NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_STATUS    = {"PASS", "WARN", "FAIL", "UNKNOWN"}
VALID_JURISDICTIONS = {"US_TCPA", "EU_GDPR", "UK_FCA", "US_HIPAA"}
REQUIRED_FIELDS = [
    "script_hash", "jurisdiction", "overall_verdict", "risk_level",
    "checks", "pass_count", "warn_count", "fail_count",
    "false_positive_disclaimer", "flags", "schema_version",
]

def validate(report: dict) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in report:
            errors.append(f"Missing required field: '{field}'")

    v = report.get("overall_verdict")
    if v is not None and v not in VALID_VERDICTS:
        errors.append(f"overall_verdict '{v}' not in {VALID_VERDICTS}")

    r = report.get("risk_level")
    if r is not None and r not in VALID_RISK:
        errors.append(f"risk_level '{r}' not in {VALID_RISK}")

    j = report.get("jurisdiction")
    if j is not None and j not in VALID_JURISDICTIONS:
        errors.append(f"jurisdiction '{j}' not in {VALID_JURISDICTIONS}")

    checks = report.get("checks", [])
    if not isinstance(checks, list):
        errors.append("checks must be a list")
    else:
        for i, check in enumerate(checks):
            if "requirement_id" not in check:
                errors.append(f"checks[{i}] missing 'requirement_id'")
            if "status" not in check:
                errors.append(f"checks[{i}] missing 'status'")
            elif check["status"] not in VALID_STATUS:
                errors.append(f"checks[{i}].status '{check['status']}' not in {VALID_STATUS}")
            if "regulation_ref" not in check:
                errors.append(f"checks[{i}] missing 'regulation_ref'")

    disclaimer = report.get("false_positive_disclaimer", "")
    if not disclaimer.strip():
        errors.append("false_positive_disclaimer must not be empty")

    # Count consistency
    pc = report.get("pass_count", -1)
    wc = report.get("warn_count", -1)
    fc = report.get("fail_count", -1)
    if isinstance(checks, list) and all(isinstance(x, int) for x in [pc, wc, fc]):
        actual_p = sum(1 for c in checks if c.get("status") == "PASS")
        actual_w = sum(1 for c in checks if c.get("status") == "WARN")
        actual_f = sum(1 for c in checks if c.get("status") == "FAIL")
        if pc != actual_p:
            errors.append(f"pass_count {pc} != actual {actual_p}")
        if wc != actual_w:
            errors.append(f"warn_count {wc} != actual {actual_w}")
        if fc != actual_f:
            errors.append(f"fail_count {fc} != actual {actual_f}")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a compliance report.")
    parser.add_argument("--report", required=True, help="Path to compliance_report.json")
    args = parser.parse_args()
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    errors = validate(report)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    print("Compliance report validation passed.")

if __name__ == "__main__":
    main()

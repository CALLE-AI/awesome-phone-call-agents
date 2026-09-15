#!/usr/bin/env python3
"""
call-fraud-shield · validate_risk_card.py

Validates a risk card produced by detect_fraud.py.

Usage:
    python3 validate_risk_card.py --card risk_card.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_FIELDS = [
    "overall_risk_score", "risk_level", "threat_categories",
    "trigger_signals", "recommended_action", "xai_explanation",
    "false_positive_disclaimer", "schema_version",
]

RISK_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"}
RECOMMENDED_ACTIONS = {"PROCEED", "FLAG_FOR_REVIEW", "CAUTION_ADVISE_USER", "TERMINATE_AND_ALERT"}
VALID_CATEGORIES = {"SPAM", "VISHING", "SOCIAL_ENGINEERING", "SCAM_SCRIPT"}

PII_PATTERNS = [
    re.compile(r"\b\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b"),
    re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),
]


def validate(card: dict) -> list[str]:
    errors: list[str] = []

    # Required fields.
    for field in REQUIRED_FIELDS:
        if field not in card:
            errors.append(f"Missing required field: '{field}'")

    # overall_risk_score.
    score = card.get("overall_risk_score")
    if not isinstance(score, (int, float)) or not (0.0 <= score <= 1.0):
        errors.append(f"overall_risk_score must be float in [0, 1], got: {score!r}")

    # risk_level.
    rl = card.get("risk_level", "")
    if rl not in RISK_LEVELS:
        errors.append(
            f"risk_level must be one of {sorted(RISK_LEVELS)}, got: {rl!r}"
        )

    # recommended_action.
    action = card.get("recommended_action", "")
    if action not in RECOMMENDED_ACTIONS:
        errors.append(
            f"recommended_action must be one of {sorted(RECOMMENDED_ACTIONS)}, got: {action!r}"
        )

    # threat_categories.
    cats = card.get("threat_categories", [])
    if not isinstance(cats, list):
        errors.append("threat_categories must be a list")
    else:
        invalid = set(cats) - VALID_CATEGORIES
        if invalid:
            errors.append(f"Invalid threat categories: {invalid}")

    # trigger_signals — each must have evidence.
    signals = card.get("trigger_signals", [])
    if not isinstance(signals, list):
        errors.append("trigger_signals must be a list")
    else:
        for i, sig in enumerate(signals):
            if not sig.get("evidence"):
                errors.append(f"trigger_signals[{i}] is missing 'evidence' span")
            if "weight" not in sig:
                errors.append(f"trigger_signals[{i}] is missing 'weight'")

    # xai_explanation must be non-empty.
    xai = card.get("xai_explanation", "")
    if not isinstance(xai, str) or not xai.strip():
        errors.append("xai_explanation must be a non-empty string")

    # false_positive_disclaimer must be non-empty.
    disclaimer = card.get("false_positive_disclaimer", "")
    if not isinstance(disclaimer, str) or not disclaimer.strip():
        errors.append("false_positive_disclaimer must be a non-empty string")

    # PII scan.
    card_text = json.dumps(card)
    for pattern in PII_PATTERNS:
        match = pattern.search(card_text)
        if match:
            errors.append(
                f"Possible raw PII in output: {match.group(0)!r}. "
                "Redact before storing."
            )

    return errors


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Validate a call-fraud-shield risk card.")
    p.add_argument("--card", required=True, help="Path to the risk card JSON file.")
    args = p.parse_args(argv)

    text = Path(args.card).read_text(encoding="utf-8")
    card = json.loads(text)
    errors = validate(card)

    if errors:
        print(f"VALIDATION FAILED — {len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  • {e}", file=sys.stderr)
        return 1

    print("Risk card is valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

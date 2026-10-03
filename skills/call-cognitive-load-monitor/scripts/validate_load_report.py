#!/usr/bin/env python3
"""validate_load_report.py — Schema validator for cognitive load monitor output."""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

VALID_LOAD_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"}
VALID_CONSENT_FLAGS = {"CONSENT_VALID", "CONSENT_AT_RISK", "CONSENT_UNKNOWN"}
VALID_ACTIONS = {"PROCEED", "FLAG_FOR_REVIEW", "SEND_WRITTEN_CONFIRMATION",
                 "REPEAT_CALL_WITH_SIMPLER_SCRIPT"}
VALID_FLAGS = {
    "REQUIRES_HUMAN_REVIEW", "CONSENT_AT_RISK", "JARGON_DENSITY_HIGH",
    "AGENT_DOMINATED_CONVERSATION", "INSUFFICIENT_TURNS_LOW_CONFIDENCE",
}
PHONE_RE = re.compile(r"\b\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
REQUIRED = [
    "call_id", "analysis_timestamp", "overall_cognitive_load", "load_score",
    "load_by_phase", "peak_phase", "overload_signals", "interaction_dynamics",
    "script_patches", "consent_validity_flag", "consent_validity_reason",
    "recommended_action", "false_positive_disclaimer", "flags", "schema_version",
]

def validate(card: dict) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED:
        if field not in card:
            errors.append(f"Missing required field: '{field}'")

    score = card.get("load_score")
    if score is not None:
        if not isinstance(score, (int, float)):
            errors.append("load_score must be a number")
        elif not (0.0 <= score <= 1.0):
            errors.append(f"load_score {score} out of range [0, 1]")

    level = card.get("overall_cognitive_load")
    if level is not None and level not in VALID_LOAD_LEVELS:
        errors.append(f"overall_cognitive_load '{level}' not in {VALID_LOAD_LEVELS}")

    cv = card.get("consent_validity_flag")
    if cv is not None and cv not in VALID_CONSENT_FLAGS:
        errors.append(f"consent_validity_flag '{cv}' not in {VALID_CONSENT_FLAGS}")

    action = card.get("recommended_action")
    if action is not None and action not in VALID_ACTIONS:
        errors.append(f"recommended_action '{action}' not in {VALID_ACTIONS}")

    pby = card.get("load_by_phase")
    if pby is not None:
        if not isinstance(pby, dict):
            errors.append("load_by_phase must be a dict")
        else:
            for phase in ("opening", "middle", "closing"):
                v = pby.get(phase)
                if v is not None and not (0.0 <= v <= 1.0):
                    errors.append(f"load_by_phase.{phase} {v} out of range [0, 1]")

    for sig in card.get("overload_signals", []):
        if "evidence" not in sig:
            errors.append(f"overload_signal missing 'evidence': {sig}")
        if "weight" not in sig:
            errors.append(f"overload_signal missing 'weight': {sig}")
        elif not (0.0 < sig["weight"] <= 1.0):
            errors.append(f"overload_signal weight {sig['weight']} out of range (0, 1]")

    disclaimer = card.get("false_positive_disclaimer", "")
    if not disclaimer.strip():
        errors.append("false_positive_disclaimer must not be empty")

    # PII check
    card_text = json.dumps(card)
    if PHONE_RE.search(card_text):
        errors.append("PII detected: raw phone number found in output")
    if EMAIL_RE.search(card_text):
        errors.append("PII detected: raw email address found in output")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a cognitive load report.")
    parser.add_argument("--report", required=True, help="Path to load_report.json")
    args = parser.parse_args()
    card = json.loads(Path(args.report).read_text(encoding="utf-8"))
    errors = validate(card)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    print("Cognitive load report validation passed.")

if __name__ == "__main__":
    main()

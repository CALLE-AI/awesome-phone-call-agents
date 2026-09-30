#!/usr/bin/env python3
"""
client-persona-profiler · validate_profile.py

Validates a persona card produced by profile_caller.py.

Usage:
    python3 validate_profile.py --card persona_card.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_FIELDS = [
    "caller_token", "interaction_count", "persona_archetype",
    "disc_scores", "rfmap_loyalty_score", "loyalty_tier",
    "churn_risk", "recommended_playbook", "schema_version",
]

ARCHETYPE_VALUES = {
    "Dominant", "Influential", "Steady", "Analytical", "Undetermined",
}
LOYALTY_TIERS = {"champion", "high_value", "at_risk", "low_value"}
CHURN_RISKS = {"low", "medium", "high", "unknown"}
TOKEN_RE = re.compile(r"^sha256:[0-9a-f]{16,}$")
PII_PATTERNS = [
    re.compile(r"\b\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b"),  # phone
    re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),         # email
]


def validate(card: dict) -> list[str]:
    errors: list[str] = []

    # Required fields.
    for field in REQUIRED_FIELDS:
        if field not in card:
            errors.append(f"Missing required field: '{field}'")

    # caller_token format.
    token = card.get("caller_token", "")
    if not TOKEN_RE.match(str(token)):
        errors.append(f"caller_token must be sha256:<hex> format, got: {token!r}")

    # interaction_count.
    ic = card.get("interaction_count")
    if not isinstance(ic, int) or ic < 1:
        errors.append(f"interaction_count must be an integer >= 1, got: {ic!r}")

    # persona_archetype.
    arch = card.get("persona_archetype", "")
    if arch not in ARCHETYPE_VALUES:
        errors.append(
            f"persona_archetype must be one of {sorted(ARCHETYPE_VALUES)}, got: {arch!r}"
        )

    # disc_scores.
    disc = card.get("disc_scores", {})
    if not isinstance(disc, dict) or set(disc.keys()) != {"D", "I", "S", "C"}:
        errors.append("disc_scores must be a dict with keys D, I, S, C")
    else:
        total = sum(disc.values())
        if not (0.99 <= total <= 1.01):
            errors.append(f"disc_scores values must sum to ~1.0, got {total:.4f}")

    # rfmap_loyalty_score.
    score = card.get("rfmap_loyalty_score")
    if not isinstance(score, (int, float)) or not (0 <= score <= 100):
        errors.append(f"rfmap_loyalty_score must be 0-100, got: {score!r}")

    # loyalty_tier.
    tier = card.get("loyalty_tier", "")
    if tier not in LOYALTY_TIERS:
        errors.append(
            f"loyalty_tier must be one of {sorted(LOYALTY_TIERS)}, got: {tier!r}"
        )

    # churn_risk.
    risk = card.get("churn_risk", "")
    if risk not in CHURN_RISKS:
        errors.append(
            f"churn_risk must be one of {sorted(CHURN_RISKS)}, got: {risk!r}"
        )

    # PII scan.
    card_text = json.dumps(card)
    for pattern in PII_PATTERNS:
        match = pattern.search(card_text)
        if match:
            errors.append(
                f"Possible raw PII detected in output: {match.group(0)!r}. "
                "Ensure all identity data is hashed before storage."
            )

    return errors


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Validate a client-persona-profiler persona card.")
    p.add_argument("--card", required=True, help="Path to the persona card JSON file.")
    args = p.parse_args(argv)

    text = Path(args.card).read_text(encoding="utf-8")
    card = json.loads(text)
    errors = validate(card)

    if errors:
        print(f"VALIDATION FAILED — {len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  • {e}", file=sys.stderr)
        return 1

    print("Persona card is valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

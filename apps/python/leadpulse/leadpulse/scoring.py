"""A fixed, explainable 0-100 lead score computed from CALL-E's validated enums.

No model is asked for a number: the same answers always give the same score, and
every point can be traced to one field.
"""
from __future__ import annotations

from typing import Any

SCORE_WEIGHTS: dict[str, dict[str, int]] = {
    "interest_level": {"strong": 35, "moderate": 22, "low": 8, "not_interested": 0, "unknown": 5},
    "timeline_urgency": {
        "within_30_days": 25,
        "one_to_three_months": 18,
        "over_three_months": 8,
        "just_researching": 3,
        "unknown": 5,
    },
    "budget_clarity": {"specific": 20, "rough": 12, "none_given": 2, "unknown": 4},
    "decision_maker": {"yes": 15, "shared": 11, "no": 4, "unknown": 5},
    "sentiment": {"positive": 5, "neutral": 2, "negative": 0, "unknown": 1},
}
QUALIFIED_THRESHOLD = 50
HOT_LEAD_THRESHOLD = 80


def explain(result: dict[str, Any]) -> dict[str, int]:
    """Points contributed by each scored field."""
    return {
        field: table.get(str(result.get(field, "unknown")), 0) for field, table in SCORE_WEIGHTS.items()
    }


def score_lead(result: dict[str, Any] | None) -> int | None:
    """0-100, or None when the lead was never actually reached."""
    if not result or result.get("reached_lead") != "yes":
        return None
    return max(0, min(100, sum(explain(result).values())))

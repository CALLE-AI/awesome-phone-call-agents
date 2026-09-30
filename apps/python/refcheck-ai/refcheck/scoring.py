"""Weighted scoring for a reference call.

Weights live here rather than in the schema: CALL-E extracts evidence, the
application decides what that evidence is worth.
"""
from __future__ import annotations

from typing import Any

# Questions that are more predictive get more weight in the final score.
WEIGHTS: dict[str, float] = {
    "q_rehire": 2.0,          # most predictive single answer in the call
    "q_strengths": 1.5,
    "q_achievement": 1.5,
    "q_fit": 1.5,
    "q_technical": 1.5,
    "q_results": 1.5,
    "q_quota": 1.5,
    "q_under_pressure": 1.2,
    "q_problem_solving": 1.2,
    "q_team_building": 1.2,
    "q_decision_making": 1.2,
    "q_collaboration": 1.0,
    "q_customer": 1.0,
    "q_objections": 1.0,
    "q_code_quality": 1.0,
    "q_strategic": 1.0,
    "q_conflict": 1.0,
    "q_coachability": 1.0,
    "q_learning": 1.0,
    "q_pipeline": 0.9,
    "q_cross_functional": 0.9,
    "q_relationship": 0.8,
    "q_role": 0.8,
    "q_areas_for_growth": 0.7,
}
DEFAULT_WEIGHT = 1.0

ENTHUSIASM_BONUS: dict[str, float] = {
    "very_enthusiastic": 0.5,
    "positive": 0.25,
    "neutral": 0.0,
    "hesitant": -0.25,
    "negative": -0.75,
    "unknown": 0.0,
}

def compute_reference_score(
    answers: dict[str, Any] | None,
    enthusiasm: str | None,
) -> float | None:
    """Weighted 0-10 score for one reference, or None if nothing was answered.

    Questions the referee did not answer are excluded from the average rather
    than being counted as neutral — a skipped question is missing evidence, not
    a middling review.
    """
    if not answers:
        return None

    weighted_sum = 0.0
    total_weight = 0.0

    for question_id, answer in answers.items():
        if not isinstance(answer, dict):
            continue
        rating = str(answer.get("rating", "not_answered"))
        if rating not in {"1", "2", "3", "4", "5"}:
            continue
        weight = WEIGHTS.get(question_id, DEFAULT_WEIGHT)
        weighted_sum += (int(rating) / 5.0 * 10.0) * weight
        total_weight += weight

    if total_weight == 0:
        return None

    base = weighted_sum / total_weight
    bonus = ENTHUSIASM_BONUS.get(enthusiasm or "unknown", 0.0)
    return round(min(10.0, max(0.0, base + bonus)), 2)


def compute_candidate_score(reference_scores: list[float]) -> float | None:
    scores = [s for s in reference_scores if s is not None]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 2)


def score_to_recommendation(score: float) -> str:
    if score >= 8.5:
        return "strong_yes"
    if score >= 7.0:
        return "yes"
    if score >= 5.5:
        return "neutral"
    if score >= 4.0:
        return "no"
    return "strong_no"

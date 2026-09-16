import json
from typing import Any


class RecallEvaluator:
    """
    Provider-agnostic interface for evaluating a learner's recall.

    A production implementation can subclass this interface and
    connect it to an LLM provider.
    """

    def evaluate(
        self,
        topic: str,
        study_context: str,
        learner_response: str,
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "Implement evaluate() using the chosen LLM provider."
        )


class DeterministicRecallEvaluator(RecallEvaluator):
    """
    Local evaluator used for testing.

    This does not use an LLM or external API.
    It provides predictable results for repository testing.
    """

    def evaluate(
        self,
        topic: str,
        study_context: str,
        learner_response: str,
    ) -> dict[str, Any]:

        if not topic.strip():
            raise ValueError("topic is required")

        if not study_context.strip():
            raise ValueError("study_context is required")

        if not learner_response.strip():
            raise ValueError("learner_response is required")

        response = learner_response.lower()

        misconceptions = []
        weak_areas = []
        concepts_remembered = []

        # Deterministic test behavior for the example topic.
        if topic.lower() == "hashing vs encryption":

            if "hashing" in response:
                concepts_remembered.append(
                    "Hashing is relevant to password-related systems"
                )

            if "decrypt" in response:
                misconceptions.append({
                    "concept": "Hashing vs encryption",
                    "student_belief": "Hashing is reversible encryption.",
                    "correct_understanding": (
                        "Hashing is generally one-way, while encryption "
                        "is designed to allow data to be recovered using "
                        "the appropriate key."
                    ),
                    "evidence_from_response": (
                        "The learner described hashing as something "
                        "that can be decrypted later."
                    )
                })

                weak_areas.append("Hashing vs encryption")

        if misconceptions:
            score = 55
            status = "misconception_detected"
            confidence = "medium"
            next_review = "1 day"

            summary = (
                "The learner remembers that hashing is related to "
                "password protection but is confusing hashing with "
                "reversible encryption."
            )

        elif concepts_remembered:
            score = 80
            status = "good"
            confidence = "medium"
            next_review = "3 days"

            summary = (
                "The learner demonstrated useful recall of the topic "
                "without a major misconception being detected."
            )

        else:
            score = 40
            status = "weak"
            confidence = "low"
            next_review = "1 day"

            summary = (
                "The learner did not demonstrate enough evidence of "
                "understanding to establish strong recall."
            )

        return {
            "topic": topic,
            "recall_score": score,
            "status": status,
            "concepts_remembered": concepts_remembered,
            "weak_areas": weak_areas,
            "misconceptions": misconceptions,
            "confidence": confidence,
            "summary": summary,
            "recommended_next_review": next_review,
        }


def validate_assessment(assessment: dict[str, Any]) -> dict[str, Any]:
    """
    Validate the structured assessment returned by an evaluator.
    """

    required_fields = [
        "topic",
        "recall_score",
        "status",
        "concepts_remembered",
        "weak_areas",
        "misconceptions",
        "confidence",
        "summary",
        "recommended_next_review",
    ]

    for field in required_fields:
        if field not in assessment:
            raise ValueError(
                f"Missing required assessment field: {field}"
            )

    if not isinstance(assessment["recall_score"], int):
        raise ValueError("recall_score must be an integer.")

    if not 0 <= assessment["recall_score"] <= 100:
        raise ValueError("recall_score must be between 0 and 100.")

    if not isinstance(assessment["concepts_remembered"], list):
        raise ValueError("concepts_remembered must be a list.")

    if not isinstance(assessment["weak_areas"], list):
        raise ValueError("weak_areas must be a list.")

    if not isinstance(assessment["misconceptions"], list):
        raise ValueError("misconceptions must be a list.")

    valid_statuses = {
        "strong",
        "good",
        "partial",
        "weak",
        "misconception_detected",
    }

    if assessment["status"] not in valid_statuses:
        raise ValueError(
            f"Invalid status: {assessment['status']}"
        )

    valid_confidence = {"high", "medium", "low"}

    if assessment["confidence"] not in valid_confidence:
        raise ValueError(
            f"Invalid confidence: {assessment['confidence']}"
        )

    return assessment


def format_assessment(assessment: dict[str, Any]) -> str:
    """
    Convert an assessment into readable JSON.
    """

    validated = validate_assessment(assessment)

    return json.dumps(
        validated,
        indent=2,
        ensure_ascii=False,
    )
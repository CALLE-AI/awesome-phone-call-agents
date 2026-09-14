from typing import Any


def evaluate_safety(result: dict[str, Any]) -> dict[str, Any]:
    """
    Convert CALL-E structured_result into a normalized
    safety decision.

    This function deliberately uses conservative rules.
    Unknown or ambiguous evidence does not become danger.
    """

    status = result.get("safety_status", "unknown")
    distress = result.get("distress_detected", "unknown")
    confirmed = result.get("user_confirmed_danger", "unknown")
    reason = result.get("reason", "")

    if confirmed == "yes":
        return {
            "status": "danger",
            "reason": reason or "User confirmed immediate danger.",
            "distress_detected": distress == "yes",
            "user_confirmed_danger": True,
        }

    if status == "danger":
        return {
            "status": "danger",
            "reason": reason or "CALL-E detected a possible danger.",
            "distress_detected": distress == "yes",
            "user_confirmed_danger": False,
        }

    if status == "concern" or distress == "yes":
        return {
            "status": "concern",
            "reason": reason or "CALL-E detected a concerning signal.",
            "distress_detected": True,
            "user_confirmed_danger": False,
        }

    if status == "safe":
        return {
            "status": "safe",
            "reason": reason or "No safety concern detected.",
            "distress_detected": False,
            "user_confirmed_danger": False,
        }

    return {
        "status": "unknown",
        "reason": reason or "Insufficient information to determine safety.",
        "distress_detected": distress == "yes",
        "user_confirmed_danger": False,
    }
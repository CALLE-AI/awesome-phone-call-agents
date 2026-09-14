from app.safety.engine import safety_engine


def test_danger():
    payload = {
        "id": "call_test_001",
        "status": "completed",
        "metadata": {
            "session_id": "walk_demo_001"
        },
        "structured_result": {
            "safety_status": "danger",
            "distress_detected": "yes",
            "user_confirmed_danger": "yes",
            "reason": "User said someone was following them.",
        },
        "summary": "User reported a possible threat.",
        "evidence": [
            "User reported being followed.",
            "User confirmed immediate danger.",
        ],
    }

    result = safety_engine.process_call_result(payload)

    print("\nDANGER TEST")
    print("=" * 50)
    print(result)


def test_safe():
    payload = {
        "id": "call_test_002",
        "status": "completed",
        "metadata": {
            "session_id": "walk_demo_002"
        },
        "structured_result": {
            "safety_status": "safe",
            "distress_detected": "no",
            "user_confirmed_danger": "no",
            "reason": "User completed the walk safely.",
        },
        "summary": "User appears safe.",
        "evidence": [
            "User reported no problems.",
        ],
    }

    result = safety_engine.process_call_result(payload)

    print("\nSAFE TEST")
    print("=" * 50)
    print(result)


if __name__ == "__main__":
    test_danger()
    test_safe()
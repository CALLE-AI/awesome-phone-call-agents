from app.safety.rules import evaluate_safety


class SafetyEngine:

    def process_call_result(self, call_payload: dict) -> dict:
        structured_result = (
            call_payload.get("structured_result")
            or {}
        )

        decision = evaluate_safety(
            structured_result
        )

        return {
            "call_id": call_payload.get("id"),
            "metadata": call_payload.get("metadata", {}),
            "decision": decision,
            "summary": call_payload.get("summary"),
            "evidence": call_payload.get("evidence", []),
            "status": call_payload.get("status"),
        }


safety_engine = SafetyEngine()
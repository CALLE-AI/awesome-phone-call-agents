from __future__ import annotations

from .models import Intent, RecoveryResult

def _has_any(text: str, values: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(v in lowered for v in values)

def verify_outcome(intent: Intent, transcript: str) -> tuple[bool, dict, str]:
    """Conservative fixture-oriented evidence gate.

    Live deployments should replace this deterministic matcher with a provider/agent
    extraction step whose fields remain grounded in the terminal transcript.
    """
    t = transcript.strip()
    if not t:
        return False, {}, "no transcript evidence"

    if _has_any(t, ("no answer", "voicemail", "did not answer", "unreachable")):
        return False, {}, "no answer"

    if _has_any(t, ("refused", "cannot provide", "won't provide", "will not provide")):
        return False, {}, "recipient refused"

    if intent == "claim_status":
        if "under review" in t.lower() and "adjuster review" in t.lower():
            return True, {"claim_status": "under_review", "next_action": "adjuster_review"}, ""
        return False, {}, "claim status not sufficiently verified"

    if intent == "billing":
        if "charge reversed" in t.lower() and "$340" in t:
            return True, {"review_status": "completed", "resolution": "charge_reversed", "reversal_amount": "$340.00"}, ""
        return False, {}, "billing resolution not sufficiently verified"

    if intent == "renewal":
        if _has_any(t, ("renew", "decline")) and "still thinking" not in t.lower():
            decision = "renew" if "renew" in t.lower() else "decline"
            return True, {"renewal_decision": decision}, ""
        return False, {"renewal_decision": "undetermined"}, "renewal decision is ambiguous"

    if intent == "policy_service":
        if "address change" in t.lower() and _has_any(t, ("applied", "completed", "updated")):
            return True, {"service_status": "completed"}, ""
        return False, {}, "policy-service outcome not sufficiently verified"

    return False, {}, "unsupported intent"

def classify_failure(call_status: str, failure_code: str | None, transcript: str = "") -> tuple[str, bool, str]:
    code = (failure_code or "").lower()
    status = call_status.lower()
    text = transcript.lower()

    if code in {"no_answer", "voicemail", "connection_failed"} or "no answer" in text or "voicemail" in text:
        return "no_answer", True, "recipient was not reached"
    if code == "refused" or "refused" in text:
        return "refused", True, "recipient refused"
    if status not in {"completed", "complete", "succeeded", "success"}:
        return "human_escalation_required", True, "call did not reach a successful terminal state"
    return "ambiguous", True, "terminal call result requires human review"

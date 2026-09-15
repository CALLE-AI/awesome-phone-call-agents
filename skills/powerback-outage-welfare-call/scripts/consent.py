# -*- coding: utf-8 -*-
"""Pre-call preview and task text.

Two safety behaviours live here, and both are **prompt constraints**, not filters:
the AI self-disclosure is always prepended to the task text, and the disclosure
allowlist is enumerated into it. We can prove what we sent to the model; we do not
claim the model can never stray. See references/safety.md.
"""

# Fixed AI self-disclosure. Always the first sentence of any task text.
AI_DISCLOSURE_OPENING = (
    "You are speaking with PowerBack, an automated AI assistant calling on behalf of "
    "the local disaster response coordination. This call may be summarized for welfare tracking."
)

SCENARIO_SCRIPTS = {
    "outage_welfare_check": (
        "Ask if the resident and their electric medical equipment user are safe, "
        "whether they currently have power, and roughly how many hours of battery remain."
    ),
    "resource_needs_survey": (
        "Ask what support they need most right now: generator, oxygen refill, "
        "evacuation assistance, or medical attention."
    ),
    "evacuation_notice_confirm": (
        "Inform them of the evacuation guidance and confirm they understood by asking "
        "them to repeat where they should go."
    ),
}

# Disclosure budget: what each allowlisted item permits the agent to say.
DISCLOSURE_SNIPPETS = {
    "caller_identity": "You may state you call for the disaster response coordination.",
    "outage_status": "You may share the current outage status for their district.",
    "nearest_shelter": "You may share the nearest shelter with backup power.",
    "estimated_restore_time": "You may share the estimated power restoration time.",
    "emergency_hotline": "You may share the emergency hotline number 1991.",
}


def build_task(call_input: dict) -> str:
    """Assemble the task text: disclosure opening, scenario script, disclosure budget."""
    parts = [AI_DISCLOSURE_OPENING, SCENARIO_SCRIPTS[call_input["scenario"]]]
    allowed = [DISCLOSURE_SNIPPETS[k] for k in call_input["disclosure_allowlist"]]
    parts.append("Information you are allowed to share: " + " ".join(allowed))
    parts.append(
        "Do NOT share any other information. If asked something outside this list, "
        "say you will arrange a human follow-up. If the person declines to talk, "
        "thank them and end the call immediately."
    )
    parts.append("Keep the call under two minutes. Speak clearly and slowly.")
    return " ".join(parts)


def build_preview(call_input: dict) -> dict:
    """Pre-call preview for a human operator. This is what consent-first gates on.

    The phone number is masked here and in the task text copy, so the preview can be
    shown, logged, or screen-shared without exposing the full number.
    """
    phone = call_input["phone"]
    masked = phone[:4] + "*" * max(len(phone) - 6, 0) + phone[-2:]
    return {
        "case_id": call_input["case_id"],
        "phone_masked": masked,
        "scenario": call_input["scenario"],
        "language": call_input["language"],
        "disclosure_allowlist": list(call_input["disclosure_allowlist"]),
        "task_text": build_task(call_input).replace(phone, masked),
    }

"""Authority sign-off via a real phone call (CALL-E).

Pattern: an autonomous agent system already auto-authorized a high-stakes
action under a real, named delegated-authority tier (a policy, an on-call
role, a legal signatory, a budget owner — whatever your system's own
authority model defines). The person that decision was made *in the name
of* has not necessarily seen it yet. This places a real phone call to
THAT person's own pre-registered number — never a third party, never an
emergency number, never anyone who has not explicitly configured their own
line for this — explains the decision in plain language, and returns a
structured confirm/override you feed back into whatever function your
system already uses to apply a human decision to that record. It does not
gate the action (the action already happened); it closes the accountability
loop after the fact.

This is deliberately narrower than a pre-action approval gate (see
`deployment-approval-call` and `incident-escalation-call` in this
repository for that pattern) — it is for systems that already resolve
things autonomously and need a real, attributable post-hoc confirm/veto
channel, not a blocking gate before the action runs.

Safe by default: with no CALLE_API_KEY, no recipient phone number, or the
enable flag not explicitly "true", this never places a real call — it
returns a dry-run result describing exactly what it would have said. A
call failure (busy/no-answer/timeout/API error) also resolves as
"unclear" rather than raising, so a flaky phone line can never leave a
caller's workflow hanging.

Reference implementation using this exact pattern in production:
GovOS (https://github.com/shubhangi-mish/agents-for-humans/tree/main/govos),
a Strands Agents-based autonomous incident-response system for Delhi. See
../../../skills/authority-signoff-call/references/govos-reference-implementation.md.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

logger = logging.getLogger("authority_signoff_call")

RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["decision"],
    "properties": {
        "decision": {"type": "string", "enum": ["confirm", "override", "unclear"]},
        "notes": {"type": "string"},
    },
}


def _dry_run_reason() -> str | None:
    if not os.getenv("CALLE_API_KEY"):
        return "CALLE_API_KEY not set"
    if not os.getenv("CALLE_SIGNOFF_PHONE"):
        return "CALLE_SIGNOFF_PHONE not set"
    if os.getenv("CALLE_SIGNOFF_ENABLED", "false").lower() != "true":
        return 'CALLE_SIGNOFF_ENABLED is not "true"'
    return None


def build_task(
    *, authority_name: str, context: str, decision_summary: str, authorizing_tier: str, amount: str | None
) -> str:
    """The natural-language call goal handed to CALL-E. Kept as a plain
    function so a caller can preview exactly what will be said without
    placing a call.

    Frames this explicitly as reviewing an already-recorded log entry, not
    issuing or seeking a live operational directive — verified necessary
    against the real CALL-E API (see references/safety.md's "Lesson from
    testing"): an earlier version of this text that described the decision
    in direct operational language ("Deploy Medical/Ambulance Unit...
    hospital access blocked") was rejected outright by CALL-E's own
    call-creation safety check as seeking "an operational decision for an
    active emergency or disaster response." That rejection was correct
    behavior on CALL-E's part — this skill is a post-hoc log review, never
    a live directive, and the call script should say so unambiguously
    rather than rely on a classifier inferring it."""
    amount_clause = f" (amount: {amount})" if amount else ""
    return (
        "This is a routine administrative call about a decision already recorded by an "
        "automated system. It is not a live emergency, does not seek a real-time operational "
        "decision, and does not direct or affect any live incident, dispatch, or safety-critical "
        f"process — say this plainly if asked. You are calling {authority_name} to review one "
        f"log entry. Speak clearly and briefly. Context: {context}. The system's policy engine "
        f"already recorded the following as authorized under {authorizing_tier}{amount_clause}: "
        f"\"{decision_summary}\". Ask whether they want to CONFIRM this log entry as recorded, "
        "or OVERRIDE it (flag it for correction). Politely end the call once you have a clear "
        "answer. If they are unavailable or the line doesn't answer, record the outcome as "
        "unclear."
    )


async def request_signoff_call(
    *,
    authority_name: str,
    context: str,
    decision_summary: str,
    authorizing_tier: str,
    amount: str | None = None,
    idempotency_key: str,
) -> dict[str, Any]:
    """Places (or, if not configured/enabled, simulates) the sign-off
    call. Returns {"decision": "confirm"|"override"|"unclear",
    "dry_run": bool, "raw": <full CALL-E result or None>}."""
    task = build_task(
        authority_name=authority_name,
        context=context,
        decision_summary=decision_summary,
        authorizing_tier=authorizing_tier,
        amount=amount,
    )

    reason = _dry_run_reason()
    if reason:
        logger.info("[DRY RUN — %s] Would call %s to sign off: %s", reason, authority_name, task)
        return {"decision": "unclear", "dry_run": True, "raw": None, "dry_run_reason": reason, "task": task}

    def _place_call() -> dict[str, Any]:
        from calle import CalleClient  # imported lazily — an optional runtime dependency

        client = CalleClient(api_key=os.environ["CALLE_API_KEY"])
        return client.calls.create_and_wait(
            task=task,
            recipient={"phone": os.environ["CALLE_SIGNOFF_PHONE"]},
            result_schema=RESULT_SCHEMA,
            metadata={"source": "authority-signoff-call"},
            idempotency_key=idempotency_key,
            timeout_seconds=180.0,
        )

    try:
        # create_and_wait polls with a blocking sleep internally — never
        # call it directly on an asyncio event loop.
        call = await asyncio.to_thread(_place_call)
    except Exception:
        logger.exception("Sign-off call failed (idempotency_key=%s)", idempotency_key)
        return {"decision": "unclear", "dry_run": False, "raw": None, "error": True, "task": task}

    structured = call.get("structured_result") or {}
    decision = structured.get("decision", "unclear")
    if decision not in ("confirm", "override", "unclear"):
        decision = "unclear"
    return {"decision": decision, "dry_run": False, "raw": call, "task": task}

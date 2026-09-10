# -*- coding: utf-8 -*-
"""Dial adapters: Fake (fully local) and Real (CALL-E SDK, gated).

FakeAdapter covers the outcomes a welfare call actually produces, including the
awkward ones: refusal, wrong person, voicemail, mid-call drop, escalation request,
and a proxy answering for the resident.

RealAdapter refuses to dial unless an API key is present AND live calling has been
explicitly enabled in the environment. That is deliberate: the destructive action
here is placing a real phone call to a stranger.
"""
import os
import re


class FakeAdapter:
    """Local simulation. Makes no network connection of any kind.

    The scenario is chosen from the case_id suffix:
      -OK      answered, needs help        -DECL     declined to talk
      -NOANS   no answer                   -VM       voicemail
      -WRONG   wrong person answered       -PARTIAL  call dropped mid-way
      -ESCAL   asked for a human           -PROXY    family member answered
      -THIN    audio unclear, low confidence
    Anything else returns an unknown status, which the engine fails closed on.
    """

    def dial(self, call_input: dict, task_text: str) -> dict:
        cid = call_input["case_id"]
        if cid.endswith("-OK"):
            return {
                "status": "completed",
                "raw_confidence": 0.92,
                "transcript_summary": [
                    "Recipient confirmed they are safe.",
                    "Recipient reported power is out, battery about 3 hours left.",
                    "Recipient asked for a generator.",
                ],
                "answered_by": "target",
                "declined": False,
                # The real CALL-E SDK returns a structured_result bound to the
                # declared schema. Simulating that is what makes this branch
                # actionable; see -PARTIAL for the case where it does not.
                "sdk_structured": {
                    "is_safe": "yes",
                    "has_power": "no",
                    "battery_hours_left": 3.0,
                    "needs": ["generator"],
                },
            }
        if cid.endswith("-DECL"):
            return {
                "status": "completed",
                "raw_confidence": 0.95,
                # A refusal produces no content evidence. It is not data about the person.
                "transcript_summary": [],
                "answered_by": "target",
                "declined": True,
            }
        if cid.endswith("-NOANS"):
            return {"status": "no_answer", "raw_confidence": 1.0,
                    "transcript_summary": [], "answered_by": None, "declined": False}
        if cid.endswith("-VM"):
            return {"status": "voicemail", "raw_confidence": 1.0,
                    "transcript_summary": [], "answered_by": "voicemail", "declined": False}
        if cid.endswith("-WRONG"):
            return {"status": "completed", "raw_confidence": 0.9,
                    "transcript_summary": ["Person answering stated they are not the resident."],
                    "answered_by": "wrong_person", "declined": False}
        if cid.endswith("-PARTIAL"):
            # Dropped mid-call: half the information, medium confidence. Clears the gate,
            # but the unconfirmed fields stay 'unknown' rather than being guessed.
            return {
                "status": "completed",
                "raw_confidence": 0.68,
                "transcript_summary": [
                    "Recipient confirmed they are safe.",
                    "Call dropped before power status could be confirmed.",
                ],
                "answered_by": "target",
                "declined": False,
                # No sdk_structured on purpose: the call dropped before the model
                # could fill the schema. Anything we infer from the words alone is
                # advisory and goes to a human.
            }
        if cid.endswith("-ESCAL"):
            # Asked for a human: honour it immediately, do not keep questioning.
            return {
                "status": "completed",
                "raw_confidence": 0.9,
                "transcript_summary": ["Recipient asked to speak with a human coordinator."],
                "answered_by": "target",
                "declined": False,
                "requested_human": True,
            }
        if cid.endswith("-PROXY"):
            # A family member answered. Valid response; the evidence records who spoke.
            return {
                "status": "completed",
                "raw_confidence": 0.85,
                "transcript_summary": [
                    "Family member answered on behalf of the resident.",
                    "Reported the resident is safe, power is out, asked for oxygen refill.",
                ],
                "answered_by": "proxy",
                "declined": False,
                "sdk_structured": {
                    "is_safe": "yes",
                    "has_power": "no",
                    "battery_hours_left": None,
                    "needs": ["oxygen_refill"],
                },
            }
        if cid.endswith("-THIN"):
            return {
                "status": "completed",
                "raw_confidence": 0.35,  # below threshold: the engine emits no result
                "transcript_summary": ["Audio unclear, fragmented responses."],
                "answered_by": "target",
                "declined": False,
            }
        # Unknown scenario: fail closed rather than assume success.
        return {"status": "unknown", "raw_confidence": 0.0,
                "transcript_summary": [], "answered_by": None, "declined": False}


class DestinationNotAuthorised(PermissionError):
    """Raised when a live call target is not on the operator's explicit allowlist."""


def _normalise_e164(raw: str) -> str:
    """Return a strict ASCII E.164 number, or raise.

    Strict on purpose: a destination is the one field where a lookalike character
    silently sends the call somewhere else. No unicode digits, no separators, no
    leading-zero trunk prefixes - the caller must supply a fully qualified number.
    """
    if not isinstance(raw, str):
        raise DestinationNotAuthorised("destination is not a string")
    if not raw.isascii():
        raise DestinationNotAuthorised(
            "destination contains non-ASCII characters - refusing to dial")
    if not re.fullmatch(r"\+[1-9][0-9]{6,14}", raw):
        raise DestinationNotAuthorised(
            f"destination {raw!r} is not strict E.164 (+<country><number>)")
    return raw


def load_allowed_destinations() -> set:
    """Operator-controlled allowlist of numbers this deployment may call.

    Source: PB_ALLOWED_DESTINATIONS, a comma-separated list of E.164 numbers.
    Absent or empty means **no destination is authorised** - fail-closed. There is
    deliberately no wildcard: a welfare call batch should never be able to dial an
    arbitrary number because a roster row was wrong.
    """
    raw = os.environ.get("PB_ALLOWED_DESTINATIONS", "")
    return {_normalise_e164(part.strip()) for part in raw.split(",") if part.strip()}


def authorise_destination(phone: str) -> str:
    """Validate the number and check it against the operator allowlist.

    Returns the normalised number. Raises DestinationNotAuthorised otherwise.
    """
    number = _normalise_e164(phone)
    allowed = load_allowed_destinations()
    if not allowed:
        raise DestinationNotAuthorised(
            "PB_ALLOWED_DESTINATIONS is empty - no live destination is authorised "
            "(fail-closed). Set it to the operator-approved E.164 numbers.")
    if number not in allowed:
        raise DestinationNotAuthorised(
            "destination is not on PB_ALLOWED_DESTINATIONS - refusing to dial")
    return number


class RealAdapter:
    """CALL-E SDK wrapper. Refuses to dial unless every gate is open."""

    RESULT_SCHEMA = {
        "type": "object",
        "required": ["is_safe", "has_power"],
        "properties": {
            "is_safe": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "has_power": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "battery_hours_left": {"type": ["number", "null"]},
            "needs": {"type": "array", "items": {"type": "string", "enum": [
                "generator", "oxygen_refill", "evacuation", "medical", "none"]}},
        },
    }

    def dial(self, call_input: dict, task_text: str) -> dict:
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise PermissionError(
                "CALLE_API_KEY is not set - RealAdapter refuses to run (fail-closed).")
        if os.environ.get("PB_ALLOW_REAL_CALL") != "1":
            raise PermissionError(
                "PB_ALLOW_REAL_CALL != 1 - placing a real call requires the operator to "
                "enable it explicitly in the environment. This is a third gate, on top of "
                "live mode and human confirmation.")
        # The destination is validated and authorised before the SDK is even imported.
        # Previously the recipient was never passed to CALL-E at all, so a "live" call
        # could not reach the intended household; and the allowlist described in
        # references/call_input.schema.json was documented but never enforced.
        to_number = authorise_destination(call_input["phone"])

        from calle import CalleClient

        client = CalleClient(api_key=api_key)
        call = client.calls.create_and_wait(
            to=to_number,
            task=task_text,
            result_schema=self.RESULT_SCHEMA,
        )
        status = call.get("status")
        conf = (call.get("completion_confidence") or {}).get("score", 0.0)
        structured = call.get("structured_result")
        # Normalise onto the FakeAdapter shape so the engine has one code path.
        return {
            "status": "completed" if status == "completed" else status or "unknown",
            "raw_confidence": conf,
            "transcript_summary": call.get("evidence") or [],
            "answered_by": "target" if call.get("task_completed") else None,
            "declined": False,
            "sdk_structured": structured,
        }

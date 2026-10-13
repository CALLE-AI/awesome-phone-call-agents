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


# Pinned SDK contract. Everything below targets this exact published version:
#   pip install calle-ai==1.0.1   (imported as `calle`)
# SDK 1.0 replaced recipient/recipients with a single flat `phone`, made
# idempotency_key and result_schema required, moved to POST /v2/calls, and removed
# structured_result / confidence / summary from the response. The result schema must
# follow the calle.result.scalar-object.v1 profile: scalar properties only, at most
# 32 of them, additionalProperties false, no arrays and no nulls.
CALLE_SDK_VERSION = "1.0.1"


class RealAdapter:
    """CALL-E SDK wrapper for calle-ai==1.0.1. Refuses to dial unless every gate is open."""

    # Scalar-object profile: the array `needs` and the nullable battery field of the
    # pre-1.0 schema cannot be expressed here, so each need is its own boolean and an
    # unknown battery level is conveyed by omitting the property rather than by null.
    RESULT_SCHEMA = {
        "type": "object",
        "additionalProperties": False,
        "required": ["is_safe", "has_power", "confidence_label"],
        "properties": {
            "is_safe": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "has_power": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "battery_hours_left": {"type": "number"},
            "needs_generator": {"type": "boolean"},
            "needs_oxygen_refill": {"type": "boolean"},
            "needs_evacuation": {"type": "boolean"},
            "needs_medical": {"type": "boolean"},
            "declined_to_talk": {"type": "boolean"},
            "reached_intended_resident": {"type": "boolean"},
            "confidence_label": {"type": "string", "enum": ["high", "medium", "low"]},
        },
    }

    # Maps the flat boolean fields back onto the internal needs list.
    _NEED_FIELDS = (
        ("needs_generator", "generator"),
        ("needs_oxygen_refill", "oxygen_refill"),
        ("needs_evacuation", "evacuation"),
        ("needs_medical", "medical"),
    )

    # The engine gates on a number; SDK 1.0 no longer reports one, so the schema asks
    # the model for a label instead. This mapping is the only place the two meet, and
    # the label is self-reported - see references/safety.md.
    _CONFIDENCE = {"high": 0.9, "medium": 0.7, "low": 0.3}

    def build_request(self, call_input, task_text, idempotency_key):
        """Assemble the create_and_wait kwargs for calle-ai==1.0.1.

        Separated from dial() so the request contract can be asserted offline,
        with no SDK installed and no call placed.
        """
        request = {
            "task": task_text,
            "phone": authorise_destination(call_input["phone"]),
            "result_schema": self.RESULT_SCHEMA,
            "idempotency_key": idempotency_key,
            "metadata": {
                "skill": "powerback-outage-welfare-call",
                "case_id": call_input["case_id"],
            },
        }
        if call_input.get("region"):
            request["region"] = call_input["region"]
        if call_input.get("locale"):
            request["locale"] = call_input["locale"]
        return request

    @staticmethod
    def idempotency_key(call_input, batch_id):
        """Durable key: the same case in the same batch must never be called twice.

        Persist batch_id before the first request and reuse it for network retries,
        as the SDK requires.
        """
        key = "powerback:{}:{}:v1".format(batch_id, call_input["case_id"])
        if not key.strip():
            raise ValueError("A stable idempotency_key is required.")
        return key

    def dial(self, call_input, task_text, batch_id=""):
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise PermissionError(
                "CALLE_API_KEY is not set - RealAdapter refuses to run (fail-closed).")
        if os.environ.get("PB_ALLOW_REAL_CALL") != "1":
            raise PermissionError(
                "PB_ALLOW_REAL_CALL != 1 - placing a real call requires the operator to "
                "enable it explicitly in the environment. This is a third gate, on top of "
                "live mode and human confirmation.")
        batch_id = batch_id or os.environ.get("PB_BATCH_ID", "")
        if not batch_id.strip():
            raise PermissionError(
                "PB_BATCH_ID is not set - no durable idempotency key can be built, and a "
                "network retry could place a second call to the same household "
                "(fail-closed).")

        # The destination is validated and authorised before the SDK is imported.
        request = self.build_request(
            call_input, task_text, self.idempotency_key(call_input, batch_id))

        from calle import CalleClient

        with CalleClient(api_key=api_key) as client:
            call = client.calls.create_and_wait(**request)
        return self.normalise(call)

    def normalise(self, call):
        """Map a 1.0.1 call object onto the shape the engine consumes.

        SDK 1.0 removed structured_result, confidence and summary. What remains is
        `result` / `error` / `result_status` / `call_outcome` / `transcript`.
        """
        if call.get("error") is not None:
            return {"status": "unknown", "raw_confidence": 0.0,
                    "transcript_summary": [], "answered_by": None, "declined": False}

        outcome = call.get("call_outcome")
        transcript = [turn.get("text", "") for turn in (call.get("transcript") or [])
                      if turn.get("speaker") == "user" and turn.get("text")]

        if outcome in ("no_answer", "no-answer", "busy"):
            return {"status": "no_answer", "raw_confidence": 1.0,
                    "transcript_summary": [], "answered_by": None, "declined": False}
        if outcome == "voicemail":
            return {"status": "voicemail", "raw_confidence": 1.0,
                    "transcript_summary": [], "answered_by": "voicemail",
                    "declined": False}
        if outcome == "declined":
            return {"status": "completed", "raw_confidence": 1.0,
                    "transcript_summary": [], "answered_by": "target", "declined": True}

        result = call.get("result")
        if call.get("result_status") != "ready" or result is None:
            # unavailable / not_applicable / anything unrecognised: fail closed. The
            # engine turns a sub-threshold confidence into insufficient_data.
            return {"status": "completed", "raw_confidence": 0.0,
                    "transcript_summary": transcript, "answered_by": "target",
                    "declined": False}

        if result.get("declined_to_talk"):
            return {"status": "completed", "raw_confidence": 1.0,
                    "transcript_summary": [], "answered_by": "target", "declined": True}

        answered_by = ("target" if result.get("reached_intended_resident", True)
                       else "wrong_person")
        needs = [name for field, name in self._NEED_FIELDS if result.get(field)]
        structured = {
            "is_safe": result.get("is_safe", "unknown"),
            "has_power": result.get("has_power", "unknown"),
            "battery_hours_left": result.get("battery_hours_left"),
            "needs": needs or ["none"],
        }
        return {
            "status": "completed",
            "raw_confidence": self._CONFIDENCE.get(result.get("confidence_label"), 0.0),
            "transcript_summary": transcript,
            "answered_by": answered_by,
            "declined": False,
            "sdk_structured": structured,
        }

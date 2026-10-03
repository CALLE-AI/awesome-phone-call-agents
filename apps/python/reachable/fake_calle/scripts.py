"""The scripted call outcomes.

Each script is a function of the destination that returns a terminal CallTask in
the OpenAPI 0.7.0 shape. Between them they cover every branch the disposition
classifier can take, including the ones that must NOT succeed.
"""

from __future__ import annotations

from typing import Any, Callable

from reachable.calls.client import call_task, turn

Script = Callable[[str, dict[str, Any]], dict[str, Any]]


def _contact_result(**overrides: Any) -> dict[str, Any]:
    base = {
        "outcome": "reached",
        "identity_confirmed": "yes",
        "still_willing_to_be_contact": "yes",
        "best_number_for_school": "this_number",
        "language_preference_note": "",
        "verbatim_identity_quote": "Yes, speaking.",
    }
    base.update(overrides)
    return base


def _pattern_result(**overrides: Any) -> dict[str, Any]:
    base = {
        "outcome": "reached",
        "identity_confirmed": "yes",
        "aware_of_absence": "yes",
        "reason_category": "illness",
        "reason_note": "Unwell since Monday.",
        "barrier_mentioned": "no",
        "barrier_note": "",
        "wants_call_from_attendance_officer": "no",
        "knows_child_whereabouts": "yes",
        "verbatim_quotes": ["Speaking, yes.", "Yes I know, she's been poorly."],
    }
    base.update(overrides)
    return base


def _shared_result(
    metadata: dict[str, Any], *, outcome: str, identity: str, quote: str = ""
) -> dict[str, Any]:
    """A result in whichever shape the workflow's schema asked for.

    Outcomes like wrong_person and not_in_service happen in both workflows, and
    CALL-E returns a result matching the schema we sent -- so the fake must do
    the same, or a shared script would be schema-invalid in one of them.
    """
    if metadata.get("workflow") == "pattern_followup":
        return _pattern_result(
            outcome=outcome,
            identity_confirmed=identity,
            aware_of_absence="unknown",
            reason_category="unknown",
            reason_note="",
            barrier_mentioned="unknown",
            wants_call_from_attendance_officer="unknown",
            knows_child_whereabouts="unknown",
            verbatim_quotes=[quote] if quote else [],
        )
    return _contact_result(
        outcome=outcome,
        identity_confirmed=identity,
        still_willing_to_be_contact="unknown",
        best_number_for_school="unknown",
        verbatim_identity_quote=quote,
    )


# --------------------------------------------------------------------- scripts


def clean_identity(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """A clean confirmation, backed by a turn the recipient actually spoke."""
    return call_task(
        "call_clean",
        destination=destination,
        metadata=metadata,
        structured_result=_contact_result(),
        score=0.93,
        label="high",
        summary="Contact confirmed identity and willingness.",
        evidence=["Contact said 'Yes, speaking.'"],
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "Yes, speaking.", 4),
            turn("bot", "Are you still happy to be an emergency contact?", 12),
            turn("user", "Yes, of course, this is the best number for me.", 18),
        ],
    )


def identity_only_in_bot_turn(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """The extraction claims identity, but only the BOT ever says the name.

    This MUST fail binding. It is the exact shape of an unbound result: a
    plausible structured answer with nothing the recipient said behind it.
    """
    return call_task(
        "call_botonly",
        destination=destination,
        metadata=metadata,
        structured_result=_contact_result(verbatim_identity_quote="Yes."),
        score=0.88,
        label="high",
        summary="Identity claimed but not spoken by the recipient.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact? Yes, thank you.", 0),
            turn("bot", "Are you still happy to be an emergency contact?", 9),
            turn("unknown", "...", 12),
        ],
    )


def wrong_person(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """The number has changed hands."""
    return call_task(
        "call_wrong",
        destination=destination,
        metadata=metadata,
        structured_result=_shared_result(
            metadata,
            outcome="wrong_person",
            identity="no",
            quote="Sorry, who did you say? I've had this number about a year.",
        ),
        score=0.9,
        label="high",
        summary="A different person answered.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "Sorry, who did you say? I've had this number about a year.", 5),
        ],
    )


def not_in_service(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return call_task(
        "call_dead",
        destination=destination,
        metadata=metadata,
        structured_result=_shared_result(metadata, outcome="not_in_service", identity="unknown"),
        # Observed live: the provider reports the task as not completed when
        # nobody was reached, while still returning a clear outcome.
        task_completed=False,
        score=0.95,
        label="high",
        summary="Number unobtainable.",
        transcript_turns=[],
    )


def voicemail(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Voicemail hears only 'please call the school office'. No child is named."""
    return call_task(
        "call_voicemail",
        destination=destination,
        metadata=metadata,
        structured_result=_shared_result(metadata, outcome="voicemail", identity="unknown"),
        # Observed live: the provider reports the task as not completed when
        # nobody was reached, while still returning a clear outcome.
        task_completed=False,
        score=0.91,
        label="high",
        summary="Answering machine.",
        transcript_turns=[
            turn("bot", "This is an automated message from the school. Please call the "
                        "school office when you can.", 0),
        ],
    )


def no_answer(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return call_task(
        "call_noanswer",
        destination=destination,
        metadata=metadata,
        structured_result=_shared_result(metadata, outcome="no_answer", identity="unknown"),
        # Observed live: the provider reports the task as not completed when
        # nobody was reached, while still returning a clear outcome.
        task_completed=False,
        score=0.94,
        label="high",
        summary="Nobody answered.",
        transcript_turns=[],
    )


def schema_invalid(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Schema-valid-looking but carrying a value outside the enum."""
    return call_task(
        "call_badschema",
        destination=destination,
        metadata=metadata,
        structured_result=_contact_result(identity_confirmed="probably"),
        score=0.9,
        label="high",
        summary="Extraction produced an out-of-enum value.",
        transcript_turns=[turn("user", "I think so?", 4)],
    )


def low_confidence(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Score below the floor while the LABEL still reads acceptable.

    A classifier checking only the label would accept this.
    """
    return call_task(
        "call_lowconf",
        destination=destination,
        metadata=metadata,
        structured_result=_contact_result(),
        score=0.31,
        label="medium",
        summary="Noisy line; extraction uncertain.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "...yeah?", 3),
        ],
    )


def urgent_did_not_know(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """The call this product exists for. MUST reach URGENT_HUMAN."""
    return call_task(
        "call_urgent",
        destination=destination,
        metadata=metadata,
        structured_result=_pattern_result(
            aware_of_absence="no",
            reason_category="unknown",
            reason_note="",
            barrier_mentioned="unknown",
            wants_call_from_attendance_officer="unknown",
            knows_child_whereabouts="no",
            verbatim_quotes=[
                "Yes, that's me.",
                "Sorry, what? He left for school this morning, same as always.",
                "What do you mean he's not there?",
            ],
        ),
        score=0.71,
        label="medium",
        summary="Contact did not know about the absence.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "Yes, that's me.", 4),
            turn("user", "Sorry, what? He left for school this morning, same as always.", 20),
            turn("user", "What do you mean he's not there?", 27),
        ],
    )


def pattern_support(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Illness plus a barrier: the case that shows why the workflow is worth it."""
    return call_task(
        "call_support",
        destination=destination,
        metadata=metadata,
        structured_result=_pattern_result(
            barrier_mentioned="yes",
            barrier_note="Bus fare has been difficult this month.",
            wants_call_from_attendance_officer="yes",
            verbatim_quotes=[
                "Speaking, yes.",
                "Yes I know, she's been really poorly since Monday.",
                "Honestly the bus fare has been the hard part this month.",
            ],
        ),
        score=0.87,
        label="high",
        summary="Illness, with a transport barrier and a request for a call back.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "Speaking, yes.", 3),
            turn("user", "Yes I know, she's been really poorly since Monday.", 18),
            turn("user", "Honestly the bus fare has been the hard part this month.", 41),
        ],
    )


def pattern_reason_only(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return call_task(
        "call_reason",
        destination=destination,
        metadata=metadata,
        structured_result=_pattern_result(),
        score=0.9,
        label="high",
        summary="Illness, no barrier mentioned.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "Speaking, yes.", 3),
            turn("user", "Yes I know, she's been poorly since Monday.", 15),
        ],
    )


def timeout_then_complete(destination: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """The terminal snapshot a timed-out submission reconciles to.

    The server returns this only on the SECOND read; the first is non-terminal.
    """
    return call_task(
        "call_timeout",
        destination=destination,
        metadata=metadata,
        structured_result=_contact_result(),
        score=0.9,
        label="high",
        summary="Completed after a client timeout.",
        transcript_turns=[
            turn("bot", "Am I speaking to the named contact?", 0),
            turn("user", "Yes, speaking.", 4),
        ],
    )


SCRIPTS: dict[str, Script] = {
    "clean_identity": clean_identity,
    "identity_only_in_bot_turn": identity_only_in_bot_turn,
    "wrong_person": wrong_person,
    "not_in_service": not_in_service,
    "voicemail": voicemail,
    "no_answer": no_answer,
    "schema_invalid": schema_invalid,
    "low_confidence": low_confidence,
    "urgent_did_not_know": urgent_did_not_know,
    "pattern_support": pattern_support,
    "pattern_reason_only": pattern_reason_only,
    "timeout_then_complete": timeout_then_complete,
}

#: Scripts whose first read must be non-terminal, so the reconciler is exercised.
DEFERRED = frozenset({"timeout_then_complete"})


def script_names() -> list[str]:
    return sorted(SCRIPTS)

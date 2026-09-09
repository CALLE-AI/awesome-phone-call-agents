"""Scripted CALL-E responses for the no-call demo.

These are shaped exactly like a terminal call task from `GET /v1/calls/{id}`,
including `recipients[].attempts[].transcript_turns`, so the console and the
CLI exercise the real extraction and grading path without credentials and
without dialling anybody.

Each scenario is built from the live `Plan`, so the freshness challenge echoed
back is the one that was actually issued. A scenario cannot accidentally pass
by hard-coding the right words.
"""

from __future__ import annotations

from typing import Any, Callable

from .runner import Plan

SCENARIOS: dict[str, str] = {
    "clean": "Subject answers, identifies, passes the freshness and knowledge challenges.",
    "third_party": "A relative answers and vouches that the subject is well.",
    "voicemail": "An answering machine picks up in the subject's own voice.",
    "coached": "The subject answers, but somebody in the room feeds the words.",
    "reassigned": "A stranger has the number and has never heard of the subject.",
}


def _turns(pairs: list[tuple[float, str, str]]) -> list[dict[str, Any]]:
    return [
        {"offset_seconds": at, "speaker": who, "text": said}
        for at, who, said in pairs
    ]


def _call(structured: dict[str, Any] | None, turns: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": "call_demo",
        "status": "completed",
        "structured_result": structured,
        "recipients": [{"attempts": [{"provider_call_id": None, "transcript_turns": turns}]}],
    }


def _clean(plan: Plan) -> dict[str, Any]:
    answers = {
        f"answer_{p.prompt_id}": p.expected for p in plan.prompts
    }
    said = ", ".join(plan.issued_nonce.words)
    return _call(
        {
            "answered_by": "subject",
            "claimed_to_be_subject": "yes",
            "nonce_words_heard": list(plan.issued_nonce.words),
            "nonce_words_reversed_heard": list(plan.issued_nonce.reversed_words),
            "weekday_heard": plan.issued_nonce.weekday.capitalize(),
            "another_person_present": "no",
            "subject_reported_dead": "no",
            "wrong_number": "no",
            "distress_or_confusion": "no",
            "evidence_quotes": [
                f"Yes, this is {plan.subject.display_name}.",
                f"{said}. And it's {plan.issued_nonce.weekday.capitalize()}.",
            ],
            **answers,
        },
        _turns([
            (0.0, "bot", "Am I speaking to the account holder?"),
            (3.1, "user", f"Yes, this is {plan.subject.display_name}."),
            (6.0, "bot", f"Please {plan.issued_nonce.spoken_instruction()}."),
            (9.2, "user", f"{said}. And it's {plan.issued_nonce.weekday.capitalize()}."),
        ]),
    )


def _third_party(plan: Plan) -> dict[str, Any]:
    """The Sogen Kato shape: somebody else answers and vouches."""
    return _call(
        {
            "answered_by": "third_party",
            "claimed_to_be_subject": "no",
            "nonce_words_heard": [],
            "nonce_words_reversed_heard": [],
            "weekday_heard": "",
            "another_person_present": "unknown",
            "subject_reported_dead": "no",
            "wrong_number": "no",
            "distress_or_confusion": "no",
            "evidence_quotes": [
                "He's resting, he can't come to the phone. But he's fine, I can confirm that.",
            ],
        },
        _turns([
            (0.0, "bot", "Am I speaking to the account holder?"),
            (2.6, "user", "He's resting, he can't come to the phone. But he's fine."),
        ]),
    )


def _voicemail(plan: Plan) -> dict[str, Any]:
    """Answered in the subject's own voice -- and unable to answer anything new."""
    return _call(
        {
            "answered_by": "voicemail",
            "claimed_to_be_subject": "unknown",
            "nonce_words_heard": [],
            "nonce_words_reversed_heard": [],
            "weekday_heard": "",
            "another_person_present": "no",
            "subject_reported_dead": "unknown",
            "wrong_number": "no",
            "distress_or_confusion": "unknown",
            "evidence_quotes": [
                f"You've reached {plan.subject.display_name}. Please leave a message.",
            ],
        },
        _turns([
            (0.0, "user", f"You've reached {plan.subject.display_name}. Please leave a message."),
        ]),
    )


def _coached(plan: Plan) -> dict[str, Any]:
    """Right answers, wrong provenance: an unattributed voice supplies them."""
    said = ", ".join(plan.issued_nonce.words)
    answers = {f"answer_{p.prompt_id}": p.expected for p in plan.prompts}
    return _call(
        {
            "answered_by": "subject",
            "claimed_to_be_subject": "yes",
            "nonce_words_heard": list(plan.issued_nonce.words),
            "nonce_words_reversed_heard": list(plan.issued_nonce.reversed_words),
            "weekday_heard": plan.issued_nonce.weekday.capitalize(),
            "another_person_present": "yes",
            "subject_reported_dead": "no",
            "wrong_number": "no",
            "distress_or_confusion": "unknown",
            "evidence_quotes": [said],
            **answers,
        },
        _turns([
            (0.0, "bot", "Am I speaking to the account holder?"),
            (3.0, "user", "Yes."),
            (6.0, "bot", f"Please {plan.issued_nonce.spoken_instruction()}."),
            (9.4, "unknown", f"[indistinct] {said} ... tell them it's the {plan.issued_nonce.weekday}"),
            (17.9, "user", f"{said}. {plan.issued_nonce.weekday.capitalize()}."),
        ]),
    )


def _reassigned(plan: Plan) -> dict[str, Any]:
    return _call(
        {
            "answered_by": "subject",
            "claimed_to_be_subject": "no",
            "nonce_words_heard": [],
            "nonce_words_reversed_heard": [],
            "weekday_heard": "",
            "another_person_present": "no",
            "subject_reported_dead": "unknown",
            "wrong_number": "yes",
            "distress_or_confusion": "no",
            "evidence_quotes": ["I've had this number four years. Never heard of them."],
        },
        _turns([
            (0.0, "bot", "Am I speaking to the account holder?"),
            (2.2, "user", "I've had this number four years. Never heard of them."),
        ]),
    )


BUILDERS: dict[str, Callable[[Plan], dict[str, Any]]] = {
    "clean": _clean,
    "third_party": _third_party,
    "voicemail": _voicemail,
    "coached": _coached,
    "reassigned": _reassigned,
}

#: Which scenario each demo subject tells. Only one of the five passes.
SUBJECT_SCENARIOS: dict[str, str] = {
    "s-1041": "clean",
    "s-1042": "third_party",
    "s-1043": "voicemail",
    "s-1044": "clean",
    "s-1045": "coached",
    "s-1046": "clean",
}


def scripted_call(plan: Plan, scenario: str) -> dict[str, Any]:
    if scenario not in BUILDERS:
        raise KeyError(f"unknown scenario {scenario!r}; choose from {sorted(BUILDERS)}")
    return BUILDERS[scenario](plan)

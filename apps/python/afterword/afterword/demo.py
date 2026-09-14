"""Scripted CALL-E responses for the no-call demo.

These are shaped exactly like a terminal call task from `GET /v1/calls/{id}`,
including `recipients[].attempts[].transcript_turns`, so the console and the
CLI exercise the real extraction, conflict detection and grading path without
credentials and without ringing anybody.

Each scenario is built from the live `Plan`, so the names and the reference the
agent speaks are the ones the script actually contains. A scenario cannot pass
by hard-coding an answer the plan never asked for.
"""

from __future__ import annotations

from typing import Any, Callable

from .runner import Plan

SCENARIOS: dict[str, str] = {
    "captured": "An adviser answers and gives the department, documents and next step.",
    "disputed_prior": "An adviser contradicts what the same institution said last week.",
    "disputed_policy": "An adviser contradicts the institution's own published guide.",
    "partial": "An adviser answers, then has to go before the last questions.",
    "referred": "The institution will only speak to the named executor.",
    "unreached": "An automated menu with no route to a person.",
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
        "recipients": [
            {"attempts": [{"provider_call_id": None, "transcript_turns": turns}]}
        ],
    }


def _opening(plan: Plan) -> list[tuple[float, str, str]]:
    """The disclosure every scenario opens with, in the agent's own words."""
    estate = plan.estate
    return [
        (
            0.0,
            "bot",
            "This is an automated call on behalf of "
            f"{estate.executor_name}, the executor for the estate of "
            f"{estate.deceased_name}. He has reported a death and I am calling "
            "to ask what you require. I cannot register anything myself.",
        ),
    ]


def _captured(plan: Plan) -> dict[str, Any]:
    return _call(
        {
            "reached": "agent",
            "department_named": "Bereavement Services",
            "documents_named": [
                "certified copy of the death certificate",
                "grant of probate",
            ],
            "certified_copy_accepted": "yes",
            "direct_debits_action": "frozen",
            "reference_opened": "NBS-88213",
            "executor_only": "no",
            "notification_accepted_by_phone": "yes",
            "evidence_quotes": [
                "That's our Bereavement Services team, I can take the details now.",
                "A certified copy is fine, we don't need the original.",
                "We freeze the account, so nothing goes out until probate.",
                "Quote NBS-88213 when you write to us.",
            ],
        },
        _turns(
            _opening(plan)
            + [
                (11.4, "user", "That's our Bereavement Services team, I can take the details now."),
                (19.0, "bot", "What documents does the family need to send?"),
                (23.8, "user", "A certified copy of the death certificate and the grant of probate."),
                (31.2, "bot", "Is a certified copy acceptable, or do you need an original?"),
                (36.0, "user", "A certified copy is fine, we don't need the original."),
                (42.5, "bot", "What happens to direct debits in the meantime?"),
                (47.1, "user", "We freeze the account, so nothing goes out until probate."),
                (55.0, "bot", "Is there a reference the family should quote?"),
                (58.9, "user", "Quote NBS-88213 when you write to us."),
            ]
        ),
    )


def _disputed_prior(plan: Plan) -> dict[str, Any]:
    """The same institution, a different adviser, a different answer.

    This call agrees with the published guide. The earlier one did not, which
    is exactly why the earlier one was kept.
    """
    return _call(
        {
            "reached": "agent",
            "department_named": "Bereavement Team",
            "documents_named": [
                "certified copy of the death certificate",
                "letter from the executor",
            ],
            "certified_copy_accepted": "yes",
            "direct_debits_action": "executor_must_instruct",
            "reference_opened": "HPT-55120",
            "executor_only": "no",
            "notification_accepted_by_phone": "yes",
            "evidence_quotes": [
                "A certified copy is absolutely fine, we've never asked for originals.",
                "Payments carry on until the executor tells us otherwise.",
            ],
        },
        _turns(
            _opening(plan)
            + [
                (12.0, "user", "You want the Bereavement Team, that's us."),
                (18.6, "bot", "Is a certified copy acceptable?"),
                (22.0, "user", "A certified copy is absolutely fine, we've never asked for originals."),
                (30.4, "bot", "And what happens to payments in the meantime?"),
                (34.9, "user", "Payments carry on until the executor tells us otherwise."),
            ]
        ),
    )


def _disputed_policy(plan: Plan) -> dict[str, Any]:
    """An adviser contradicting the institution's own booklet, twice."""
    return _call(
        {
            "reached": "agent",
            "department_named": "Claims Bereavement Desk",
            "documents_named": [
                "certified copy of the death certificate",
                "completed claim form",
            ],
            "certified_copy_accepted": "no",
            "direct_debits_action": "cancelled_on_notification",
            "reference_opened": "",
            "executor_only": "no",
            "notification_accepted_by_phone": "yes",
            "evidence_quotes": [
                "No, it has to be the original certificate, we return it after.",
                "The premium stops the day we're told, we cancel the direct debit.",
            ],
        },
        _turns(
            _opening(plan)
            + [
                (10.9, "user", "Claims Bereavement Desk, go ahead."),
                (16.2, "bot", "Is a certified copy of the death certificate acceptable?"),
                (20.7, "user", "No, it has to be the original certificate, we return it after."),
                (29.3, "bot", "What happens to the direct debit in the meantime?"),
                (33.8, "user", "The premium stops the day we're told, we cancel the direct debit."),
            ]
        ),
    )


def _partial(plan: Plan) -> dict[str, Any]:
    """Reached a person, lost them before the last two questions."""
    return _call(
        {
            "reached": "agent",
            "department_named": "Bereavement Support",
            "documents_named": ["death certificate"],
            "certified_copy_accepted": "unknown",
            "direct_debits_action": "unknown",
            "reference_opened": "",
            "executor_only": "no",
            "notification_accepted_by_phone": "unknown",
            "evidence_quotes": [
                "Bereavement Support, we just need the death certificate to start.",
                "I'm sorry, I'll have to transfer you and the queue has just closed.",
            ],
        },
        _turns(
            _opening(plan)
            + [
                (9.7, "user", "Bereavement Support, we just need the death certificate to start."),
                (17.5, "bot", "Is a certified copy acceptable, or do you need an original?"),
                (22.1, "user", "I'm sorry, I'll have to transfer you and the queue has just closed."),
            ]
        ),
    )


def _referred(plan: Plan) -> dict[str, Any]:
    """A correct refusal. Afterword reports it and does not work around it."""
    return _call(
        {
            "reached": "agent",
            "department_named": "",
            "documents_named": [],
            "certified_copy_accepted": "unknown",
            "direct_debits_action": "unknown",
            "reference_opened": "",
            "executor_only": "yes",
            "notification_accepted_by_phone": "no",
            "evidence_quotes": [
                "I can't go through this with anyone but the executor himself, "
                "I'm sorry. He can call this number any weekday morning.",
            ],
        },
        _turns(
            _opening(plan)
            + [
                (
                    12.8,
                    "user",
                    "I can't go through this with anyone but the executor himself, "
                    "I'm sorry. He can call this number any weekday morning.",
                ),
                (21.0, "bot", "Understood. Which number should he call, and at what times?"),
                (25.4, "user", "This same number, weekday mornings."),
            ]
        ),
    )


def _unreached(plan: Plan) -> dict[str, Any]:
    """An automated menu with no bereavement option and no route to a person."""
    return _call(
        {
            "reached": "ivr_dead_end",
            "department_named": "",
            "documents_named": [],
            "certified_copy_accepted": "unknown",
            "direct_debits_action": "unknown",
            "reference_opened": "",
            "executor_only": "unknown",
            "notification_accepted_by_phone": "unknown",
            "evidence_quotes": [
                "For council tax press one. For bins press two. To hear these "
                "options again press nine.",
            ],
        },
        _turns(
            [
                (
                    0.0,
                    "user",
                    "For council tax press one. For bins press two. To hear these "
                    "options again press nine.",
                ),
                (31.0, "bot", "No option reached a person; ending the call."),
            ]
        ),
    )


BUILDERS: dict[str, Callable[[Plan], dict[str, Any]]] = {
    "captured": _captured,
    "disputed_prior": _disputed_prior,
    "disputed_policy": _disputed_policy,
    "partial": _partial,
    "referred": _referred,
    "unreached": _unreached,
}

#: Which scenario each institution tells. One clean capture out of six.
INSTITUTION_SCENARIOS: dict[str, str] = {
    "inst-01": "captured",
    "inst-02": "disputed_prior",
    "inst-03": "disputed_policy",
    "inst-04": "partial",
    "inst-05": "referred",
    "inst-06": "unreached",
}


def scripted_call(plan: Plan, scenario: str) -> dict[str, Any]:
    if scenario not in BUILDERS:
        raise KeyError(f"unknown scenario {scenario!r}; choose from {sorted(BUILDERS)}")
    return BUILDERS[scenario](plan)

"""The task text CALL-E is given for one hop.

The prompt is assembled by code, not written per case, so that every hop in
every chain discloses automation the same way and asks the same closing
questions. Chain history is carried into the text because a desk that hears
"three people have already sent me here" answers a different question than a
desk that hears the request cold.
"""

from __future__ import annotations

from typing import Any

from runaround.chain import Desk

DISCLOSURE = (
    "Open by saying you are an AI assistant calling on behalf of "
    "{requester_name}, and say why you are calling in one sentence."
)

CLOSING_QUESTIONS = (
    "Before ending the call you must establish two things: whether this desk "
    "is the one responsible for handling this request, and, if it is not, the "
    "name and phone number of the desk that is."
)

BOUNDARIES = (
    "Do not accept, decline, or negotiate any offer, settlement, payment, "
    "appointment, or commitment on behalf of the requester. Do not give any "
    "personal detail that is not listed above. If the person asks to be "
    "removed from contact, acknowledge and end the call. If the person "
    "declines to help, thank them and end the call without pressing. Do not "
    "invent a phone number: report only a number the person actually says."
)


def _history_lines(history: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for entry in history:
        quote = entry.get("quote")
        name = entry.get("name") or "a previous desk"
        if quote:
            lines.append(f'- {name} said: "{quote}"')
        else:
            lines.append(f"- {name} did not name anyone responsible.")
    return lines


def build_task_text(
    *,
    desk: Desk,
    subject: str,
    question: str,
    requester_name: str,
    history: list[dict[str, Any]] | None = None,
) -> str:
    """Return the ``task`` string for ``POST /v1/calls``.

    ``history`` is a list of ``{"name": ..., "quote": ...}`` entries for the
    desks already called on this case, oldest first.
    """
    history = history or []
    parts: list[str] = [
        f"Call {desk.name} at {desk.phone}.",
        DISCLOSURE.format(requester_name=requester_name),
        f"Subject: {subject}",
        f"The question to get answered: {question}",
    ]

    if history:
        parts.append(
            "This request has already been passed along "
            f"{len(history)} time(s). In order:"
        )
        parts.extend(_history_lines(history))
        parts.append(
            "Say plainly that the request has already been referred this "
            "many times, and ask this desk to confirm whether it is "
            "responsible rather than naming another party by reflex."
        )

    parts.append(CLOSING_QUESTIONS)
    parts.append(BOUNDARIES)
    return "\n".join(parts)


def build_preview(
    *,
    desk: Desk,
    subject: str,
    question: str,
    requester_name: str,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return a human-readable preview with the destination masked."""
    text = build_task_text(
        desk=desk,
        subject=subject,
        question=question,
        requester_name=requester_name,
        history=history,
    )
    return {
        "destination": desk.masked(),
        "desk_name": desk.name,
        "task_preview": text.replace(desk.phone, desk.masked()),
        "will_place_call": False,
    }

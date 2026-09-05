"""Gathering.

The collector compiles a rubric into a CALL-E task and result schema, places one
multi-recipient call, and turns what came back into `Answer` objects.

It cannot rule. `Answer` has no verdict field, so there is nowhere for an opinion
to go even if this module wanted to form one. Everything here is about capturing
what a branch said and, separately, the words it said it in.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from concord.models import Answer, Audit, ConcordError, Rubric

DISCLOSURE = (
    "At the very start of the call, say that you are an AI assistant calling on "
    "behalf of {org} to check the information given to callers, and that this is "
    "not a mystery-shopper test of the individual answering."
)


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["branches_reached"],
        "properties": {
            "branches_reached": {"type": "integer"},
            "branches_unreached": {"type": "integer"},
        },
    }


def recipient_result_schema(rubric: Rubric) -> dict[str, Any]:
    """Compile the rubric into the schema the call must answer in.

    Each criterion contributes the field it asks for plus the quote that supports
    it. Constraining the field to the rubric's own options is what stops the call
    inventing a category the policy never contemplated.
    """
    properties: dict[str, Any] = {"reached": {"type": "boolean"}}
    required = ["reached"]
    for criterion in rubric.criteria:
        field: dict[str, Any] = {"type": "string"}
        if criterion.options:
            field["enum"] = list(criterion.options)
        properties[criterion.field] = field
        properties[f"{criterion.field}_quote"] = {
            "type": "string",
            "description": "The caller's own words that support this answer.",
        }
        required.append(criterion.field)
    return {"type": "object", "required": required, "properties": properties}


def build_task(audit: Audit, rubric: Rubric) -> str:
    questions = "\n".join(
        f"{i + 1}. {c.question} Record the answer in '{c.field}'"
        + (f" as one of: {', '.join(c.options)}." if c.options else ".")
        + f" Record the exact words spoken in '{c.field}_quote'."
        for i, c in enumerate(rubric.criteria)
    )
    return (
        DISCLOSURE.format(org=audit.org)
        + "\n\n"
        + f"Scenario: {rubric.scenario}\n\n"
        + "Ask these questions in order, and only these:\n"
        + questions
        + "\n\nRules. Ask as an ordinary caller would and accept the first clear answer. "
        "Do not coach, correct, argue with or grade the person answering. Do not ask "
        "for their name, role or employee number, and do not record it if offered. "
        "Do not state what the policy says. If an answer is hedged, partial or "
        "refused, set that field to 'unclear' rather than choosing the nearest "
        "option. If the branch cannot be reached or declines to answer, set reached "
        "to false. Capture the speaker's own words for every question you get an "
        "answer to."
    )


def build_payload(audit: Audit, rubric: Rubric) -> dict[str, Any]:
    return {
        "task": build_task(audit, rubric),
        "recipients": [{"phones": [b.phone]} for b in audit.branches],
        "result_schema": result_schema(),
        "recipient_result_schema": recipient_result_schema(rubric),
        "metadata": {
            "workflow": "concord",
            "audit_id": audit.id,
            "rubric_id": rubric.id,
            "unit_of_analysis": "branch",
        },
    }


def idempotency_key(audit: Audit, rubric: Rubric) -> str:
    """Derived from the approved audit, never from the retry attempt.

    Re-sending an unchanged audit after an uncertain response reuses this key and
    cannot produce a second round of calls to the same branches.
    """
    payload = json.dumps(
        build_payload(audit, rubric), sort_keys=True, separators=(",", ":")
    )
    return "concord-" + hashlib.sha256(payload.encode()).hexdigest()[:32]


def window_is_open(audit: Audit, now: datetime | None = None) -> bool:
    """Branches are called during their own opening hours, on weekdays only."""
    try:
        tz = ZoneInfo(audit.timezone)
    except Exception as exc:  # noqa: BLE001
        raise ConcordError(f"Unknown timezone {audit.timezone!r}.") from exc
    moment = (now or datetime.now(tz)).astimezone(tz)
    if moment.weekday() >= 5:
        return False
    start_h, start_m = (int(x) for x in audit.call_window[0].split(":"))
    end_h, end_m = (int(x) for x in audit.call_window[1].split(":"))
    minutes = moment.hour * 60 + moment.minute
    return start_h * 60 + start_m <= minutes <= end_h * 60 + end_m


def answers_from_result(rubric: Rubric, call_result: dict[str, Any], audit: Audit) -> list[Answer]:
    """Turn one completed CALL-E result into answers.

    Two rules that an earlier version got wrong.

    Results are correlated to a branch by the destination that was dialled, not
    by position in the returned array. A provider that drops, reorders or adds a
    recipient would otherwise shift every answer onto the wrong branch, and a
    missing recipient would make a branch disappear by shortening the list.

    Every branch in the audit produces an answer for every criterion, whether or
    not the provider returned anything for it. A branch with no result is
    recorded as unreached, which rules UNCLEAR. A silent branch must reach the
    report, because a branch that vanishes reads as a branch with nothing wrong.

    Answers are built through `Answer.parse`, so the self-identification scrub
    that protects fixture data also protects live provider output. Constructing
    `Answer` directly here would bypass the one guard that keeps a spoken name
    out of the record, on the only path where a real name can occur.
    """
    by_phone: dict[str, dict[str, Any]] = {}
    leftovers: list[dict[str, Any]] = []
    for recipient in call_result.get("recipients", []):
        phones = recipient.get("phones") or []
        phone = str(phones[0]) if phones else str(recipient.get("phone", "") or "")
        if phone:
            by_phone[phone] = recipient
        else:
            leftovers.append(recipient)

    answers: list[Answer] = []
    for index, branch in enumerate(audit.branches):
        recipient = by_phone.get(branch.phone)
        if recipient is None and not by_phone and index < len(leftovers):
            # Provider echoed no destinations at all: fall back to order, which
            # is the documented request order, rather than dropping everything.
            recipient = leftovers[index]
        structured = (recipient or {}).get("structured_result") or {}
        reached = bool(structured.get("reached", bool(structured))) if recipient else False
        for criterion in rubric.criteria:
            answers.append(
                Answer.parse(
                    {
                        "branch_id": branch.id,
                        "criterion_id": criterion.id,
                        "value": structured.get(criterion.field, "") or "",
                        "quote": structured.get(f"{criterion.field}_quote", "") or "",
                        "reached": reached,
                    }
                )
            )
    return answers

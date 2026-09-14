"""Post-call routing decided only from the structured result.

Routing never reads a transcript. Every branch depends on the closed enums in
`schema.py`, so a decision can be replayed and audited from the stored result
alone, and a new enum value shows up here as a missing branch rather than as a
silently mis-sorted lead.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .models import Lead
from .schema import enum_of

SUCCESS_STATUSES = frozenset({"completed", "succeeded"})
#: A decline is ambiguous: CALL-E reports one both when a person refuses the
#: call and when the route failed before any media was established. Retrying is
#: the safer reading, because the attempt budget stops it after `--max-attempts`
#: and hands the lead to `manual_review` instead of dialling a real refusal for
#: ever. An explicit refusal spoken on the call is a different signal, and
#: `right_person` / `continued_after_ai_disclosure` still suppress the number.
RETRYABLE_STATUSES = frozenset(
    {
        "no_answer",
        "busy",
        "failed",
        "expired",
        "canceled",
        "cancelled",
        "declined",
        "rejected",
    }
)
MIN_COMPLETION_CONFIDENCE = 0.8

#: Everything in the payment_blocker enum that is an actual obstacle.
KNOWN_BLOCKERS = frozenset(enum_of("payment_blocker")) - {"none", "unknown"}

ROUTE_BOOK = "book_specialist_callback"
ROUTE_PAYMENT = "payment_support"
ROUTE_NURTURE = "nurture_sequence"
ROUTE_CLOSE = "close_lead"
ROUTE_SUPPRESS = "suppress_number"
ROUTE_RETRY = "retry_later"
ROUTE_REVIEW = "manual_review"


@dataclass(frozen=True)
class Decision:
    route: str
    priority: str
    reason: str
    follow_up_allowed: bool
    suppress_number: bool
    payment_blocker: str = "unknown"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _answer(structured: dict[str, Any], field: str) -> str:
    """Optional fields may be absent; absent and unclear both mean unknown."""
    value = structured.get(field)
    return value if isinstance(value, str) else "unknown"


def route_outcome(
    lead: Lead,
    structured: Any,
    *,
    provider_status: str | None = None,
    task_completed: bool | None = None,
    completion_confidence: float | None = None,
) -> Decision:
    """Map one completed call into a single next action for the sales team."""
    if provider_status is not None and provider_status not in SUCCESS_STATUSES:
        route = ROUTE_RETRY if provider_status in RETRYABLE_STATUSES else ROUTE_REVIEW
        return Decision(
            route=route,
            priority="low",
            reason=f"Provider status {provider_status!r} is not a completed call.",
            follow_up_allowed=True,
            suppress_number=False,
        )

    if not isinstance(structured, dict):
        return Decision(
            route=ROUTE_REVIEW,
            priority="low",
            reason="The call returned no structured result.",
            follow_up_allowed=True,
            suppress_number=False,
        )

    right_person = _answer(structured, "right_person")
    continued = _answer(structured, "continued_after_ai_disclosure")
    intent = _answer(structured, "buying_intent")
    blocker = _answer(structured, "payment_blocker")
    wants_callback = _answer(structured, "wants_human_callback")

    # Opt-out signals win over every commercial signal, including a missing
    # provider completion flag.
    if right_person == "no":
        return Decision(
            route=ROUTE_SUPPRESS,
            priority="none",
            reason="The number does not belong to the lead; stop calling it.",
            follow_up_allowed=False,
            suppress_number=True,
        )
    if continued == "no":
        return Decision(
            route=ROUTE_SUPPRESS,
            priority="none",
            reason="The person declined to continue after AI disclosure.",
            follow_up_allowed=False,
            suppress_number=True,
        )
    if wants_callback == "no":
        return Decision(
            route=ROUTE_CLOSE,
            priority="none",
            reason="The person did not want a human follow-up call.",
            follow_up_allowed=False,
            suppress_number=False,
            payment_blocker=blocker,
        )
    if intent == "not_interested":
        return Decision(
            route=ROUTE_CLOSE,
            priority="none",
            reason="The person is no longer importing a vehicle.",
            follow_up_allowed=False,
            suppress_number=False,
        )

    if task_completed is False:
        # A person who was reached and consented is not redialled just because
        # the provider says the script did not finish. They already answered;
        # another call re-asks what they have answered. A human reads the gaps
        # and decides, the same way an unclear callback consent is handled
        # below. Only a call that never reached that point is retried.
        if right_person == "yes" and continued == "yes":
            return Decision(
                route=ROUTE_REVIEW,
                priority="low",
                reason=(
                    "The call task was reported as not completed, but the person "
                    "was reached and consented; a human decides before calling again."
                ),
                follow_up_allowed=True,
                suppress_number=False,
                payment_blocker=blocker,
            )
        return Decision(
            route=ROUTE_RETRY,
            priority="low",
            reason="The provider reported the call task as not completed.",
            follow_up_allowed=True,
            suppress_number=False,
        )
    if (
        completion_confidence is not None
        and completion_confidence < MIN_COMPLETION_CONFIDENCE
    ):
        return Decision(
            route=ROUTE_REVIEW,
            priority="low",
            reason=(
                f"Completion confidence {completion_confidence} is below "
                f"{MIN_COMPLETION_CONFIDENCE}; a human should read the call."
            ),
            follow_up_allowed=True,
            suppress_number=False,
            payment_blocker=blocker,
        )

    if right_person != "yes" or continued != "yes":
        return Decision(
            route=ROUTE_REVIEW,
            priority="low",
            reason="Identity or disclosure consent was left unclear.",
            follow_up_allowed=True,
            suppress_number=False,
            payment_blocker=blocker,
        )
    if wants_callback != "yes":
        return Decision(
            route=ROUTE_REVIEW,
            priority="low",
            reason="Follow-up consent was not clearly given; a human decides before calling.",
            follow_up_allowed=False,
            suppress_number=False,
            payment_blocker=blocker,
        )

    market = lead.market.region_hint
    if intent == "ready_to_buy":
        if blocker in KNOWN_BLOCKERS:
            return Decision(
                route=ROUTE_PAYMENT,
                priority="high",
                reason=f"Ready to buy in {market} but blocked by {blocker}.",
                follow_up_allowed=True,
                suppress_number=False,
                payment_blocker=blocker,
            )
        return Decision(
            route=ROUTE_BOOK,
            priority="high" if blocker == "none" else "medium",
            reason=f"Ready to buy in {market} with payment blocker {blocker}.",
            follow_up_allowed=True,
            suppress_number=False,
            payment_blocker=blocker,
        )

    if intent == "comparing":
        route = ROUTE_PAYMENT if blocker in KNOWN_BLOCKERS else ROUTE_NURTURE
        return Decision(
            route=route,
            priority="medium",
            reason=f"Comparing options in {market} with payment blocker {blocker}.",
            follow_up_allowed=True,
            suppress_number=False,
            payment_blocker=blocker,
        )

    if intent == "just_browsing":
        return Decision(
            route=ROUTE_NURTURE,
            priority="low",
            reason="Still gathering information; no purchase decision is close.",
            follow_up_allowed=True,
            suppress_number=False,
            payment_blocker=blocker,
        )

    return Decision(
        route=ROUTE_REVIEW,
        priority="low",
        reason=f"Buying intent came back as {intent!r}.",
        follow_up_allowed=True,
        suppress_number=False,
        payment_blocker=blocker,
    )

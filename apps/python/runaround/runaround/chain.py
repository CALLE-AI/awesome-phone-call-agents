"""The referral chain: what one call outcome means, and where it may lead.

The whole point of this app lives here, and none of it touches a network. A
hop outcome is decided from the validated result alone; the chain decision is
decided from that outcome plus the desks already visited.

Two rules carry the design:

* A referral advances the chain only when the recipient's own words are
  attached to it. An unquoted referral is a machine's paraphrase, and it is
  refused.
* A destination that has already been called is a closed loop, not a next
  hop. The chain stops and says so, with both quotes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from runaround import phone

# What one call produced.
HOP_ANSWERED = "answered"
HOP_REFERRED = "referred"
HOP_UNVERIFIED_REFERRAL = "unverified_referral"
HOP_OWNER_WITHOUT_ANSWER = "owner_without_answer"
HOP_DEAD_END = "dead_end"
HOP_UNREACHABLE = "unreachable"

# What the chain should do next.
CHAIN_RESOLVED = "resolved"
CHAIN_LOOP_DETECTED = "loop_detected"
CHAIN_SELF_REFERRAL = "self_referral"
CHAIN_REFERRED_TO_REQUESTER = "referred_to_requester"
CHAIN_LOOP_SUSPECTED = "loop_suspected"
CHAIN_AWAITING_APPROVAL = "awaiting_approval"
CHAIN_BUDGET_EXHAUSTED = "budget_exhausted"
CHAIN_NEEDS_HUMAN = "needs_human"
CHAIN_CONTINUE = "continue"

#: Chain states in which no further call may be placed without a human.
TERMINAL_CHAIN_STATES = frozenset(
    {
        CHAIN_RESOLVED,
        CHAIN_LOOP_DETECTED,
        CHAIN_SELF_REFERRAL,
        CHAIN_REFERRED_TO_REQUESTER,
        CHAIN_BUDGET_EXHAUSTED,
        CHAIN_NEEDS_HUMAN,
    }
)

_ORG_SUFFIXES = (
    " inc",
    " llc",
    " ltd",
    " limited",
    " corp",
    " corporation",
    " co",
)


def fold_name(name: str | None) -> str:
    """Return a comparable form of an organization name.

    Used only to *suspect* a loop when two different numbers answer for the
    same-sounding organization. A suspicion pauses the chain for a human; it
    never terminates the chain on its own, because names are not identities.
    """
    if not name:
        return ""
    lowered = name.casefold()
    kept = [
        character
        for character in lowered
        if character.isalnum() or character == " "
    ]
    collapsed = " ".join("".join(kept).split())
    for suffix in _ORG_SUFFIXES:
        collapsed = collapsed.removesuffix(suffix)
    return collapsed.strip()


@dataclass(frozen=True)
class Desk:
    """One organization or department that can be called."""

    name: str
    phone: str
    region: str | None = None

    def identity(self) -> str:
        return phone.identity(self.phone)

    def masked(self) -> str:
        return phone.mask(self.phone)

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "phone": self.phone, "region": self.region}

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Desk:
        return Desk(
            name=str(data["name"]),
            phone=phone.normalize(str(data["phone"])),
            region=data.get("region"),
        )


@dataclass
class Referral:
    """A next destination, and the words that licensed it."""

    target_name: str | None
    target_phone: str
    quote: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_name": self.target_name,
            "target_phone": self.target_phone,
            "quote": self.quote,
        }


@dataclass
class HopVerdict:
    """What one call outcome means on its own."""

    outcome: str
    reason: str
    referral: Referral | None = None
    answer: str | None = None
    reference_number: str | None = None


@dataclass
class ChainDecision:
    """What the chain does next, given a hop verdict and the visited desks."""

    state: str
    reason: str
    next_desk: Desk | None = None
    loop_path: list[str] = field(default_factory=list)

    @property
    def is_terminal(self) -> bool:
        return self.state in TERMINAL_CHAIN_STATES


def classify_hop(
    *,
    call_status: str,
    result: dict[str, Any] | None,
    rejection: str | None = None,
) -> HopVerdict:
    """Decide what a single call produced.

    ``rejection`` carries the message from :mod:`runaround.schema` when the
    returned result could not be validated. An unvalidatable result is
    unreachable ground: it never becomes "no referral".
    """
    if call_status != "completed":
        return HopVerdict(
            outcome=HOP_UNREACHABLE,
            reason=f"call ended in status {call_status!r}, not completed",
        )
    if rejection is not None:
        return HopVerdict(
            outcome=HOP_UNREACHABLE,
            reason=f"result refused: {rejection}",
        )
    if result is None:
        return HopVerdict(
            outcome=HOP_UNREACHABLE,
            reason="call completed without a structured result",
        )

    owns = result["owns_request"]
    answered = result["question_answered"]

    if owns == "yes" and answered == "yes":
        return HopVerdict(
            outcome=HOP_ANSWERED,
            reason="this desk stated it owns the request and answered it",
            answer=result["answer_summary"],
            reference_number=result["reference_number"],
        )
    if owns == "yes":
        return HopVerdict(
            outcome=HOP_OWNER_WITHOUT_ANSWER,
            reason=(
                "this desk stated it owns the request but did not answer the "
                "question on this call"
            ),
            reference_number=result["reference_number"],
        )

    target_phone = result["referral_target_phone"]
    quote = result["referral_quote"]

    if target_phone and not quote:
        return HopVerdict(
            outcome=HOP_UNVERIFIED_REFERRAL,
            reason=(
                "a referral number was returned without the words that gave "
                "it; the chain does not dial an unquoted referral"
            ),
        )
    if quote and not target_phone:
        rejected = result.get("referral_phone_rejected")
        detail = f"; the spoken number {rejected!r} is not E.164" if rejected else ""
        return HopVerdict(
            outcome=HOP_UNVERIFIED_REFERRAL,
            reason=(
                "a referral was spoken but no usable number came with it"
                + detail
            ),
        )
    if target_phone and quote:
        return HopVerdict(
            outcome=HOP_REFERRED,
            reason="this desk referred the request elsewhere, in its own words",
            referral=Referral(
                target_name=result["referral_target_name"],
                target_phone=target_phone,
                quote=quote,
            ),
            reference_number=result["reference_number"],
        )

    return HopVerdict(
        outcome=HOP_DEAD_END,
        reason="this desk neither owns the request nor named anyone who does",
    )


def decide_next(
    *,
    verdict: HopVerdict,
    current: Desk,
    visited: list[Desk],
    requester_phone: str | None,
    hop_budget: int,
    hops_used: int,
    authorized_identities: set[str],
    auto_dial_referrals: bool,
) -> ChainDecision:
    """Decide whether the chain may place another call, and to whom.

    ``visited`` is every desk already called on this case, in order, including
    ``current``. ``hops_used`` counts calls already placed.
    """
    if verdict.outcome == HOP_ANSWERED:
        return ChainDecision(
            state=CHAIN_RESOLVED,
            reason="the owning desk answered the question",
        )
    if verdict.outcome in (
        HOP_UNREACHABLE,
        HOP_DEAD_END,
        HOP_OWNER_WITHOUT_ANSWER,
        HOP_UNVERIFIED_REFERRAL,
    ):
        return ChainDecision(state=CHAIN_NEEDS_HUMAN, reason=verdict.reason)

    referral = verdict.referral
    if referral is None:
        raise ValueError("a referred hop must carry a referral")
    target_identity = phone.identity(referral.target_phone)

    if target_identity == current.identity():
        return ChainDecision(
            state=CHAIN_SELF_REFERRAL,
            reason=(
                "this desk referred the request to its own number; there is "
                "no next hop to place"
            ),
        )

    if requester_phone and target_identity == phone.identity(requester_phone):
        return ChainDecision(
            state=CHAIN_REFERRED_TO_REQUESTER,
            reason=(
                "this desk referred the request back to the requester's own "
                "number"
            ),
        )

    visited_identities = [desk.identity() for desk in visited]
    if target_identity in visited_identities:
        start = visited_identities.index(target_identity)
        loop_path = [phone.mask(item) for item in visited_identities[start:]]
        loop_path.append(phone.mask(target_identity))
        return ChainDecision(
            state=CHAIN_LOOP_DETECTED,
            reason=(
                "the referral points at a desk this case has already called; "
                "the chain has closed on itself without reaching an owner"
            ),
            loop_path=loop_path,
        )

    if hops_used >= hop_budget:
        return ChainDecision(
            state=CHAIN_BUDGET_EXHAUSTED,
            reason=(
                f"the hop budget of {hop_budget} is spent and the chain has "
                "not reached an owner"
            ),
        )

    next_desk = Desk(
        name=referral.target_name or "Unnamed desk",
        phone=referral.target_phone,
        region=current.region,
    )

    folded = fold_name(next_desk.name)
    if folded:
        for desk in visited:
            if (
                fold_name(desk.name) == folded
                and desk.identity() != target_identity
            ):
                return ChainDecision(
                    state=CHAIN_LOOP_SUSPECTED,
                    reason=(
                        "a different number was given for an organization "
                        f"already called under the name {desk.name!r}; a "
                        "human decides whether this is the same desk"
                    ),
                    next_desk=next_desk,
                )

    if not auto_dial_referrals and target_identity not in authorized_identities:
        return ChainDecision(
            state=CHAIN_AWAITING_APPROVAL,
            reason=(
                "a number given on a call is not an authorization to dial it; "
                "this destination needs explicit approval"
            ),
            next_desk=next_desk,
        )

    return ChainDecision(
        state=CHAIN_CONTINUE,
        reason="the referral is quoted, new, and authorized",
        next_desk=next_desk,
    )

"""The recommendation engine: combines calltruth-style outcome resolution
with the structured red-flag signals from the verification call. Neither
input is trusted alone — see the module-level table below, mirrored exactly
from RINGFENCE-BUILD-SPEC.md.

Fails closed at every branch: an unknown/missing signal is never treated as
"clean," only a signal explicitly and affirmatively clean produces
``ADVISE_ALLOW``.

| Condition                                                              | Recommendation     |
|--------------------------------------------------------------------------|-------------------|
| Any red flag present (secrecy, urgency, unexplained relationship,        | ADVISE_BLOCK      |
| irreversible-payment insistence)                                        |                   |
| Explicit hold/stop requested by account holder                           | ADVISE_BLOCK      |
| resolve.classify() outcome is unresolved_ambiguous, no_answer_confirmed,  | ESCALATE_TO_HUMAN |
| rejected_before_ring, or connection_failed_during_attempt                |                   |
| Clean conversation, no red flags, explicit confirmation                  | ADVISE_ALLOW      |
| Anything not covered above                                               | ESCALATE_TO_HUMAN |

**Advisory only, human review always required.** Every value this module
returns is a *recommendation* derived from a heuristic interpretation of one
phone conversation — speech recognition, a language model's reading of what
was said, and the red-flag table in ``references/scam-red-flags.md``. That
chain is not reliable enough to move or hold someone's money on its own, so
no output of this module is an action:

- ``ADVISE_ALLOW`` means "this call surfaced no red flags," never "release
  the funds";
- ``ADVISE_BLOCK`` means "this call surfaced red flags worth a human
  looking at," never "freeze the account";
- ``ESCALATE_TO_HUMAN`` means the call established too little to recommend
  either way.

Every ``Disposition`` carries ``advisory=True`` and
``requires_human_review=True``, both serialized in ``as_dict()`` and
surfaced on every consuming surface (CLI, webhook, MCP, audit report, demo
dashboard). The institution's own system — and a human in it — makes the
consequential decision. Integrators must not wire these values straight
into an automated approve/hold action.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import resolve

ADVISE_BLOCK = "ADVISE_BLOCK"
ESCALATE_TO_HUMAN = "ESCALATE_TO_HUMAN"
ADVISE_ALLOW = "ADVISE_ALLOW"

#: Every recommendation this module can return. All of them are advisory
#: and all of them require human review before anything happens to money.
RECOMMENDATIONS = (ADVISE_ALLOW, ADVISE_BLOCK, ESCALATE_TO_HUMAN)

_UNRESOLVED_OUTCOMES = (
    resolve.UNRESOLVED_AMBIGUOUS,
    resolve.NO_ANSWER_CONFIRMED,
    resolve.REJECTED_BEFORE_RING,
    resolve.CONNECTION_FAILED_DURING_ATTEMPT,
)


@dataclass(frozen=True)
class Disposition:
    """One advisory recommendation plus the reasons behind it.

    ``advisory`` and ``requires_human_review`` are structural, not
    configurable: there is no code path that produces a non-advisory
    recommendation or one safe to act on without a human. They are fields
    rather than implicit so that every serialized record, log line, and API
    response says so explicitly to whatever consumes it.
    """

    disposition: str
    reasons: list[str] = field(default_factory=list)
    advisory: bool = True
    requires_human_review: bool = True

    def as_dict(self) -> dict:
        return {
            "disposition": self.disposition,
            "reasons": list(self.reasons),
            "advisory": True,
            "requires_human_review": True,
        }


def decide(resolution: resolve.Resolution, signals: dict) -> Disposition:
    """Recommend a disposition for a case. Advisory only — see module docs.

    ``signals`` carries the verification call's structured result fields:
    ``secrecy_demand_present``, ``urgency_pressure_present``,
    ``relationship_explained``, ``irreversible_payment_demanded``,
    ``explicit_hold_requested`` — booleans, or missing/``None`` when the
    call could not establish one (which must never be read as "clean").
    """
    if signals.get("explicit_hold_requested") is True:
        return Disposition(ADVISE_BLOCK, ["explicit_hold_requested"])

    red_flags: list[str] = []
    if signals.get("secrecy_demand_present") is True:
        red_flags.append("secrecy_demand_present")
    if signals.get("urgency_pressure_present") is True:
        red_flags.append("urgency_pressure_present")
    if signals.get("relationship_explained") is False:
        red_flags.append("relationship_not_explained")
    if signals.get("irreversible_payment_demanded") is True:
        red_flags.append("irreversible_payment_demanded")
    if red_flags:
        return Disposition(ADVISE_BLOCK, red_flags)

    if resolution.outcome in _UNRESOLVED_OUTCOMES:
        return Disposition(ESCALATE_TO_HUMAN, [f"calltruth_resolution={resolution.outcome}"])

    if (
        resolution.outcome == resolve.ANSWERED_SUCCESS
        and signals.get("secrecy_demand_present") is False
        and signals.get("urgency_pressure_present") is False
        and signals.get("relationship_explained") is True
        and signals.get("irreversible_payment_demanded") is False
        and signals.get("explicit_hold_requested") is False
    ):
        return Disposition(
            ADVISE_ALLOW, ["clean_conversation_no_red_flags_explicit_confirmation"]
        )

    return Disposition(ESCALATE_TO_HUMAN, ["fallback_default"])

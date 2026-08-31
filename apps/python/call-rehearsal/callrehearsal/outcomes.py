"""The library of realistic ways a phone call can actually end.

Every entry describes what was true about the *conversation*, not about any
particular result schema. A call plan is rehearsed by projecting each of these
onto the plan's own ``result_schema`` and then asking what the downstream
decision rule does with the projection.

The semantics are deliberately small and explicit:

``reached_human``
    A person the agent could talk to answered the line. Voicemail, ringing out
    and a busy signal are all ``False``.
``identity_verified``
    The person on the line was confirmed to be the intended callee.
``consent_given``
    The person agreed to continue with the purpose of the call.
``agreed``
    The answer to the single decision the call exists to establish.
    ``None`` means the call ended without establishing it.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Outcome:
    """One realistic ending of a phone call."""

    identifier: str
    label: str
    description: str
    reached_human: bool
    identity_verified: bool | None
    consent_given: bool | None
    agreed: bool | None
    records: tuple[str, ...] = field(default=())

    @property
    def is_confirmation(self) -> bool:
        """True only when a verified, consenting human actually said yes.

        This is the single predicate that separates outcomes that may trigger a
        real-world side effect from every outcome that must not.
        """
        return (
            self.reached_human
            and self.identity_verified is True
            and self.consent_given is True
            and self.agreed is True
        )


OUTCOMES: tuple[Outcome, ...] = (
    Outcome(
        identifier="human_confirmed",
        label="Verified human confirmed",
        description="The intended callee answered, consented, and said yes.",
        reached_human=True,
        identity_verified=True,
        consent_given=True,
        agreed=True,
    ),
    Outcome(
        identifier="human_declined",
        label="Verified human declined",
        description="The intended callee answered, consented, and said no.",
        reached_human=True,
        identity_verified=True,
        consent_given=True,
        agreed=False,
    ),
    Outcome(
        identifier="human_deferred",
        label="Human deferred the decision",
        description="The callee asked to decide later, so no answer was established.",
        reached_human=True,
        identity_verified=True,
        consent_given=True,
        agreed=None,
        records=("deferral",),
    ),
    Outcome(
        identifier="callback_requested",
        label="Human requested a callback",
        description="The callee asked to be called back at another time.",
        reached_human=True,
        identity_verified=True,
        consent_given=True,
        agreed=None,
        records=("deferral", "callback"),
    ),
    Outcome(
        identifier="ambiguous_answer",
        label="Answer was ambiguous",
        description="The callee responded, but not in a way that resolves the decision.",
        reached_human=True,
        identity_verified=True,
        consent_given=True,
        agreed=None,
    ),
    Outcome(
        identifier="partial_answer",
        label="Only part of the ask was answered",
        description="Some required fields were established and the decision field was not.",
        reached_human=True,
        identity_verified=True,
        consent_given=True,
        agreed=None,
    ),
    Outcome(
        identifier="consent_refused",
        label="Consent refused",
        description="The callee declined to continue with the call at all.",
        reached_human=True,
        identity_verified=True,
        consent_given=False,
        agreed=None,
        records=("consent",),
    ),
    Outcome(
        identifier="wrong_person",
        label="Wrong person answered and agreed",
        description="Somebody who is not the callee answered and said yes anyway.",
        reached_human=True,
        identity_verified=False,
        consent_given=True,
        agreed=True,
        records=("identity",),
    ),
    Outcome(
        identifier="gatekeeper_blocked",
        label="Gatekeeper would not pass the call on",
        description="A receptionist or family member answered and the callee was never reached.",
        reached_human=True,
        identity_verified=False,
        consent_given=None,
        agreed=None,
        records=("identity",),
    ),
    Outcome(
        identifier="voicemail",
        label="Voicemail answered",
        description="An answering machine picked up and no person was reached.",
        reached_human=False,
        identity_verified=False,
        consent_given=None,
        agreed=None,
        records=("reachability",),
    ),
    Outcome(
        identifier="no_answer",
        label="Nobody answered",
        description="The line rang out.",
        reached_human=False,
        identity_verified=False,
        consent_given=None,
        agreed=None,
        records=("reachability",),
    ),
    Outcome(
        identifier="line_busy",
        label="Line was busy or the call failed",
        description="The call never connected to anything.",
        reached_human=False,
        identity_verified=False,
        consent_given=None,
        agreed=None,
        records=("reachability",),
    ),
)


OUTCOMES_BY_ID = {outcome.identifier: outcome for outcome in OUTCOMES}

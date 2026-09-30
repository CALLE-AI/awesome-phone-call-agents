"""What happens when a call does not confirm.

Not confirming is the common case, so giving up on the first miss would either
strand living people or teach a scheme to ignore the signal. Muster climbs a
fixed ladder instead, and the ladder ends with a person.

One rule matters more than the rest and is enforced here rather than trusted to
a prompt: **the nominated contact may only be asked to pass on a message.**
A call to somebody else can never produce a life attestation, however
convincing what they say. That is the Kato failure, and it is closed by
construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .models import Grade

#: Grades that mean the ladder has done its job and can reset.
SETTLED = frozenset({Grade.CONFIRMED_LIVE})


class Step(str, Enum):
    PRIMARY_NUMBER = "primary_number"
    RETRY_PRIMARY = "retry_primary"
    ALTERNATE_NUMBER = "alternate_number"
    NOMINATED_CONTACT = "nominated_contact"
    HUMAN_VISIT = "human_visit"


ORDER: tuple[Step, ...] = (
    Step.PRIMARY_NUMBER,
    Step.RETRY_PRIMARY,
    Step.ALTERNATE_NUMBER,
    Step.NOMINATED_CONTACT,
    Step.HUMAN_VISIT,
)

#: Days each rung waits before the next is attempted.
RUNG_DAYS: dict[Step, int] = {
    Step.PRIMARY_NUMBER: 3,
    Step.RETRY_PRIMARY: 3,
    Step.ALTERNATE_NUMBER: 2,
    Step.NOMINATED_CONTACT: 2,
    Step.HUMAN_VISIT: 0,
}

#: Steps whose result may never be read as evidence that the subject is alive.
NEVER_ATTESTS: frozenset[Step] = frozenset({Step.NOMINATED_CONTACT, Step.HUMAN_VISIT})


@dataclass(frozen=True)
class Rung:
    step: Step
    dials: bool
    may_attest: bool
    purpose: str


RUNGS: dict[Step, Rung] = {
    Step.PRIMARY_NUMBER: Rung(
        Step.PRIMARY_NUMBER, True, True,
        "Call the enrolled number and run the four-stage protocol.",
    ),
    Step.RETRY_PRIMARY: Rung(
        Step.RETRY_PRIMARY, True, True,
        "Call the same number again at a different hour of the day.",
    ),
    Step.ALTERNATE_NUMBER: Rung(
        Step.ALTERNATE_NUMBER, True, True,
        "Call the second enrolled number, if one was registered.",
    ),
    Step.NOMINATED_CONTACT: Rung(
        Step.NOMINATED_CONTACT, True, False,
        "Ask the nominated contact to pass on a message asking the subject to "
        "call the scheme. Ask them nothing about the subject, and record "
        "nothing they volunteer as evidence.",
    ),
    Step.HUMAN_VISIT: Rung(
        Step.HUMAN_VISIT, False, False,
        "Hand the case to a person. Muster stops here.",
    ),
}


def next_step(current: Step | None, grade: Grade | None) -> Step | None:
    """The next rung, or None when the ladder is finished or settled."""
    if grade in SETTLED:
        return None
    if current is None:
        return Step.PRIMARY_NUMBER
    if current is Step.HUMAN_VISIT:
        return None
    return ORDER[ORDER.index(current) + 1]


def may_attest(step: Step) -> bool:
    """False for any rung that speaks to somebody other than the subject."""
    return step not in NEVER_ATTESTS


def days_to_human(start: Step = Step.PRIMARY_NUMBER) -> int:
    """How long the ladder takes to reach a person from a given rung."""
    return sum(RUNG_DAYS[s] for s in ORDER[ORDER.index(start):])

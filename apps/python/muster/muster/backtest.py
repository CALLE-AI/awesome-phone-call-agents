"""How long a death went unnoticed, and how long it could have.

This is a model of a schedule, not a measurement of a scheme. It answers one
question: if the subject had been on a monthly attestation cycle with the
escalation ladder in `ladder.py`, how quickly would the ladder have reached a
person?

The assumption that does the work is deliberately weak. It does not assume
Muster detects the death. It assumes only that after the death **no call can
ever return CONFIRMED_LIVE**, because nobody can pass a challenge minted
seconds ago on behalf of a dead person -- and a relative vouching is not a
pass. Every other grade climbs the ladder, and the ladder ends with a person.

That is why frequency beats strength here: the check does not need to be clever,
it needs to happen.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import cadence, ladder


@dataclass(frozen=True)
class Case:
    key: str
    title: str
    citation: str
    died: str
    detected: str
    actual_days: int
    note: str


#: Both figures below are from the cited sources, not estimated.
CASES: tuple[Case, ...] = (
    Case(
        key="suchowolski",
        title="United States v. Suchowolski",
        citation="838 F.3d 530 (5th Cir. 2016), No. 15-20409",
        died="1990",
        detected="2015",
        actual_days=25 * 365,
        note=(
            "The opinion records \"almost a quarter-century's unlawful receipt of "
            "social-security benefits in the guise of a person who died in 1990\"."
        ),
    ),
    Case(
        key="kato",
        title="Sogen Kato, Adachi ward, Tokyo",
        citation="Discovered 27 July 2010; death placed at about November 1978",
        died="1978",
        detected="2010",
        actual_days=int(31.7 * 365),
        note=(
            "Officials were rebuffed for years by relatives who said he was resting. "
            "The subsequent national audit could not confirm whether 234,354 people "
            "over 100 were alive."
        ),
    ),
)


@dataclass(frozen=True)
class Modelled:
    case: Case
    interval_days: int
    ladder_days: int
    modelled_days: int
    actual_days: int

    @property
    def reduction_factor(self) -> float:
        return self.actual_days / self.modelled_days if self.modelled_days else 0.0


def model(case: Case, interval_days: int | None = None) -> Modelled:
    """Worst-case days from death to a person picking the case up."""
    interval = interval_days if interval_days is not None else cadence.INTERVAL_DAYS[
        __import__("muster.models", fromlist=["Grade"]).Grade.CONFIRMED_LIVE
    ]
    rungs = ladder.days_to_human()
    return Modelled(
        case=case,
        interval_days=int(interval or 0),
        ladder_days=rungs,
        modelled_days=cadence.worst_case_detection_days(rungs, interval),
        actual_days=case.actual_days,
    )


def model_all(interval_days: int | None = None) -> tuple[Modelled, ...]:
    return tuple(model(case, interval_days) for case in CASES)

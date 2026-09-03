"""Turning a shortage into a call queue, and a call queue into a report.

The dispatch rule is the whole safety argument: one call in flight, re-checked
after every outcome, stopping the instant the need is met. A blood bank that
rings forty people for two units gets four donors for two chairs, three of whom
are turned away having taken time off work -- and next month none of the forty
pick up. Over-calling is not enthusiasm, it is register destruction.

So the queue is built long and consumed short. Everyone eligible is ranked, and
then almost none of them are rung. The report says how many were spared, which
is the number a blood bank should actually be judged on.

The dialler is injected. The same runner drives the fixture harness and a live
CALL-E run, so what is demonstrated offline is what executes on the phone.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Iterable, Protocol

from . import compat
from .policy import Decision, Donor, Policy, screen, suppression_histogram

CONFIRMED = "confirmed"
DECLINED = "declined"
UNCLEAR = "unclear"
NO_ANSWER = "no_answer"

# Anything that is not a clear commitment is not a commitment. It is also not a
# refusal -- an unclear answer leaves the donor in the register, uncounted,
# and the cascade simply moves on.
COMMITMENT_STATES: tuple[str, ...] = (CONFIRMED, DECLINED, UNCLEAR, NO_ANSWER)


@dataclass(frozen=True)
class Request:
    """A shortage, as the blood bank states it."""

    ref: str
    need_group: str
    component: str
    units_needed: int

    def __post_init__(self) -> None:
        if self.units_needed < 1:
            raise ValueError("units_needed must be at least 1")
        compat.callable_groups(self.need_group, self.component)

@dataclass(frozen=True)
class CallOutcome:
    """What one call produced. Returned by whatever actually dials."""

    donor_ref: str
    commitment: str
    arrival_window: str | None = None
    units: int = 1
    transcript_ref: str | None = None

    def __post_init__(self) -> None:
        if self.commitment not in COMMITMENT_STATES:
            raise ValueError(f"unknown commitment state: {self.commitment!r}")


class Dialler(Protocol):
    def __call__(self, donor: Donor, request: Request) -> CallOutcome: ...


@dataclass(frozen=True)
class Plan:
    """Who would be called, in what order, and who was ruled out and why."""

    request: Request
    queue: tuple[Donor, ...]
    suppressed: tuple[Decision, ...]
    roster_size: int

    @property
    def eligible_count(self) -> int:
        return len(self.queue)

    @property
    def histogram(self) -> dict[str, int]:
        return suppression_histogram(list(self.suppressed))


def _rank(donor: Donor, request: Request, on: date) -> tuple:
    """Call order within the eligible pool.

    Scarcity first: spend the least substitutable donor last, so an O- donor is
    never rung for an A+ request while any A+, A- or O+ donor is uncalled. Then
    most-overdue first, which spreads load across the register instead of
    exhausting the same willing handful. Then ref, so runs are reproducible.
    """
    priority = compat.donor_priority(donor.group, request.need_group, request.component)
    last = donor.last_plateletpheresis if request.component == compat.PLATELETS else donor.last_whole_blood
    # Most overdue repeat donor first. A never-donated registrant sorts last
    # within their band: repeat donors convert far better than first-timers, so
    # spending a scarce call on an unproven one is the worse bet.
    days_since = (on - last).days if last else -1
    return (priority, -days_since, donor.ref)

def build_plan(
    roster: Iterable[Donor],
    request: Request,
    on: date,
    policy: Policy | None = None,
) -> Plan:
    """Screen the whole register, then rank whoever survives."""
    roster = list(roster)
    eligible: list[Donor] = []
    suppressed: list[Decision] = []
    for donor in roster:
        decision = screen(donor, request.need_group, request.component, on, policy)
        if decision.eligible:
            eligible.append(donor)
        else:
            suppressed.append(decision)
    eligible.sort(key=lambda d: _rank(d, request, on))
    return Plan(request, tuple(eligible), tuple(suppressed), len(roster))


@dataclass(frozen=True)
class RunReport:
    """The outcome, led by what was not done."""

    request: Request
    filled: bool
    units_confirmed: int
    roster_size: int
    eligible_count: int
    calls_placed: int
    calls_not_placed: int
    suppressed_histogram: dict[str, int]
    confirmed: tuple[CallOutcome, ...] = ()
    declined: tuple[CallOutcome, ...] = ()
    unclear: tuple[CallOutcome, ...] = ()
    no_answer: tuple[CallOutcome, ...] = ()
    never_called: tuple[str, ...] = ()
    scarce_spared: dict[str, int] = field(default_factory=dict)

    def summary_lines(self) -> list[str]:
        r = self.request
        out = [
            f"request {r.ref}: {r.units_needed} unit(s) {r.need_group} {r.component}",
            f"  register {self.roster_size} -> eligible {self.eligible_count}"
            f" -> called {self.calls_placed}",
            f"  {'FILLED' if self.filled else 'NOT FILLED'}"
            f" ({self.units_confirmed}/{r.units_needed} confirmed)",
            f"  calls deliberately not placed: {self.calls_not_placed}",
        ]
        for code, n in sorted(self.suppressed_histogram.items(), key=lambda kv: -kv[1]):
            out.append(f"    {code}: {n}")
        if self.scarce_spared:
            spared = ", ".join(f"{g}x{n}" for g, n in sorted(self.scarce_spared.items()))
            out.append(f"  scarce donors left uncalled: {spared}")
        return out

def _scarce_spared(plan: Plan, called: set[str]) -> dict[str, int]:
    """Uncalled donors whose group is more broadly useful than the need itself.

    An A+ request that gets filled by A+ donors leaves the A-, O+ and O- donors
    in the pool untouched -- units that can still go to patients an A+ unit
    cannot reach. That preserved optionality is a real output, so it is counted.
    """
    need_breadth = compat.breadth(plan.request.need_group, plan.request.component)
    spared: dict[str, int] = {}
    for donor in plan.queue:
        if donor.ref in called:
            continue
        if compat.breadth(donor.group, plan.request.component) > need_breadth:
            spared[donor.group] = spared.get(donor.group, 0) + 1
    return spared


def run(
    plan: Plan,
    dial: Dialler,
    *,
    max_calls: int | None = None,
    on_dispatch: Callable[[Donor], None] | None = None,
) -> RunReport:
    """Work the queue one call at a time and stop the moment the need is met.

    Never concurrent, never speculative, never a second wave. max_calls is a
    hard budget -- when it runs out the run ends unfilled and says so, rather
    than quietly continuing.
    """
    buckets: dict[str, list[CallOutcome]] = {s: [] for s in COMMITMENT_STATES}
    units = 0
    called: set[str] = set()

    for donor in plan.queue:
        if units >= plan.request.units_needed:
            break
        if max_calls is not None and len(called) >= max_calls:
            break
        if on_dispatch is not None:
            on_dispatch(donor)
        called.add(donor.ref)
        outcome = dial(donor, plan.request)
        if outcome.donor_ref != donor.ref:
            raise ValueError(
                f"dialler returned outcome for {outcome.donor_ref!r}, expected {donor.ref!r}"
            )
        buckets[outcome.commitment].append(outcome)
        if outcome.commitment == CONFIRMED:
            units += outcome.units

    never = tuple(d.ref for d in plan.queue if d.ref not in called)
    return RunReport(
        request=plan.request,
        filled=units >= plan.request.units_needed,
        units_confirmed=units,
        roster_size=plan.roster_size,
        eligible_count=plan.eligible_count,
        calls_placed=len(called),
        calls_not_placed=len(plan.suppressed) + len(never),
        suppressed_histogram=plan.histogram,
        confirmed=tuple(buckets[CONFIRMED]),
        declined=tuple(buckets[DECLINED]),
        unclear=tuple(buckets[UNCLEAR]),
        no_answer=tuple(buckets[NO_ANSWER]),
        never_called=never,
        scarce_spared=_scarce_spared(plan, called),
    )

